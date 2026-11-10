"use server";

import { revalidatePath } from "next/cache";
import type { ReportDraftSectionInput } from "../../domain/reporting/schema";
import {
  createServiceReportDraft,
  reportingProfileForService,
  supportedReportingServiceIds,
  wizardStepsForSections,
} from "../../domain/reporting/service-profiles";
import { toClientSafeError } from "../../lib/errors/application-error";
import { enforceServerCostLimit } from "../../lib/security/server-cost-limit";
import { getClientContext, getInternalContext } from "../../lib/supabase/next-server";

/**
 * Client reporting actions.
 *
 * Two audiences, two boundaries. Sending resolves an internal context and the
 * RPC independently re-checks `reports.send`; the client actions resolve a
 * client context and every RPC behind them derives the company from auth.uid(),
 * so a company id arriving from a browser is never authoritative.
 */

/**
 * TRANSITIONAL — Phase 1 quick send.
 *
 * The internal entry point is now the Reporting builder at /reporting, and
 * Quick Action opens it. This action and the RPC behind it are deliberately
 * retained: app_send_client_report is a separate, still-tested contract, and
 * removing a working delivery path in the same pass that adds a new one would
 * leave nothing to fall back to. It is not a second reporting system.
 */
export type SendClientReportResult =
  | { ok: true }
  | { ok: false; error: string };

export async function sendClientReportAction(input: {
  requestId: string;
  companyId: string;
  reportLane: string;
  packageLabel: string;
  title: string;
  reportUrl: string;
}): Promise<SendClientReportResult> {
  try {
    const context = await getInternalContext();
    await context.services.permissions.requireModuleAccess("reporting");

    await enforceServerCostLimit({
      actorId: context.actor.id,
      action: "report.send",
      organizationId: input.companyId,
    });

    await context.services.reporting.send(
      {
        request_id: input.requestId,
        company_id: input.companyId,
        report_lane: input.reportLane,
        package_label: input.packageLabel,
        title: input.title,
        report_url: input.reportUrl,
      },
      context.actor,
    );

    /*
     * The client's own pages are what change, and they are rendered per request
     * for a different session — nothing internal caches this list in V1.
     */
    revalidatePath("/account/reporting");

    return { ok: true };
  } catch (error) {
    return { ok: false, error: toClientSafeError(error).message };
  }
}

export type ReportRecipient = { id: string; name: string };

export type ReportServiceChoice = {
  serviceId: string;
  serviceName: string;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
};

export type ReportServiceChoicesResult =
  | { ok: true; choices: ReportServiceChoice[] }
  | { ok: false; error: string };

/**
 * Service choices for one requested company.
 *
 * The database re-authorizes Reporting and returns only client-owned Services.
 * A null subscription identifies an eligible order, never a catalogue fallback.
 */
export async function listReportServiceChoicesAction(input: {
  companyId: string;
}): Promise<ReportServiceChoicesResult> {
  try {
    const context = await getInternalContext();
    const options = await context.services.reporting.listServiceOptions(
      input.companyId,
      supportedReportingServiceIds,
    );
    return {
      ok: true,
      choices: options.map((option) => ({
        serviceId: option.service_id,
        serviceName: option.service_name,
        subscriptionId: option.subscription_id,
        subscriptionStatus: option.subscription_status,
      })),
    };
  } catch (error) {
    return { ok: false, error: toClientSafeError(error).message };
  }
}

/**
 * The clients a report can be sent to.
 *
 * Loaded when the Quick Action form opens rather than threaded through the
 * shell, so no internal page pays for a directory it never shows. Internal
 * context plus company RLS decide what comes back.
 */
export async function listReportRecipientsAction(): Promise<ReportRecipient[]> {
  try {
    const context = await getInternalContext();
    await context.services.permissions.requireModuleAccess("reporting");
    const companies = await context.services.companies.listActive();
    return companies.map((company) => ({ id: company.id, name: company.name }));
  } catch {
    return [];
  }
}

export type MarkReportReadResult = { ok: boolean };

/**
 * Records that this client opened a report.
 *
 * Called when the client deliberately opens one, never on render. Failure is
 * swallowed: the report opens in a new tab either way, and interrupting that
 * with an error about an emphasis marker would be the wrong trade.
 */
export async function markClientReportReadAction(input: {
  reportId: string;
}): Promise<MarkReportReadResult> {
  try {
    const context = await getClientContext();
    await context.services.reporting.markRead(input.reportId, context.actor);

    revalidatePath("/account/reporting");
    revalidatePath(`/account/reporting/${input.reportId}`);
    revalidatePath("/account");

    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/* -----------------------------------------------------------------------------
 * The internal Reporting builder
 *
 * Every action resolves an internal context first, and every RPC behind them
 * independently re-checks for an internal actor holding reports.send through
 * the internal reporting module. A report id from a browser is request data:
 * the database re-resolves it and refuses one that is not editable.
 * -------------------------------------------------------------------------- */

export type ReportDraftResult =
  | { ok: true; reportId: string }
  | { ok: false; error: string };

export async function createReportDraftAction(input: {
  requestId: string;
  companyId: string;
  serviceId?: string | null;
  subscriptionId?: string | null;
  reportLane: string;
  packageLabel: string;
  title: string;
  wizardStepKey?: string | null;
  sections: ReportDraftSectionInput[];
}): Promise<ReportDraftResult> {
  try {
    const context = await getInternalContext();

    const report = await context.services.reporting.createDraft(
      {
        request_id: input.requestId,
        company_id: input.companyId,
        service_id: input.serviceId,
        subscription_id: input.subscriptionId,
        report_lane: input.reportLane,
        package_label: input.packageLabel,
        title: input.title,
        wizard_step_key: input.wizardStepKey,
        sections: input.sections,
      },
      context.actor,
    );

    revalidatePath("/reporting");

    return { ok: true, reportId: report.id };
  } catch (error) {
    return { ok: false, error: toClientSafeError(error).message };
  }
}

/**
 * Creates the guided draft from the server-owned service profile.
 *
 * The browser requests company/service/subscription identities only. The
 * database validates their relationship, while the server registry decides
 * package copy, order, quantities, and which one-time items remain eligible.
 */
export async function createServiceReportDraftAction(input: {
  requestId: string;
  companyId: string;
  serviceId: string;
  subscriptionId: string | null;
  title: string;
  reportingPeriodMonth?: string;
}): Promise<ReportDraftResult> {
  try {
    const profile = reportingProfileForService(input.serviceId);
    if (!profile) return { ok: false, error: "This Service has no Reporting profile." };

    const context = await getInternalContext();
    const completed = await context.services.reporting.listReportedOneTimeDeliverables({
      companyId: input.companyId,
      serviceId: input.serviceId,
      subscriptionId: input.subscriptionId,
    });
    const sections = createServiceReportDraft(profile, completed);
    const firstStep = wizardStepsForSections(sections)[0];
    if (!firstStep) return { ok: false, error: "This Service has no Reporting steps." };

    const report = await context.services.reporting.createDraft(
      {
        request_id: input.requestId,
        company_id: input.companyId,
        service_id: input.serviceId,
        subscription_id: input.subscriptionId,
        reporting_period_month: input.reportingPeriodMonth,
        report_lane: profile.reportLane,
        package_label: profile.packageLabel,
        title: input.title,
        wizard_step_key: firstStep,
        sections,
      },
      context.actor,
    );

    revalidatePath("/reporting");
    return { ok: true, reportId: report.id };
  } catch (error) {
    return { ok: false, error: toClientSafeError(error).message };
  }
}

export type SaveReportDraftResult = { ok: true } | { ok: false; error: string };

export async function saveReportDraftAction(input: {
  reportId: string;
  reportLane: string;
  packageLabel: string;
  title: string;
  wizardStepKey?: string | null;
  /** First-of-month "YYYY-MM-01". Omitted or null leaves the stored period untouched. */
  reportingPeriodMonth?: string | null;
  sections: ReportDraftSectionInput[];
}): Promise<SaveReportDraftResult> {
  try {
    const context = await getInternalContext();

    await context.services.reporting.saveDraft(
      {
        report_id: input.reportId,
        report_lane: input.reportLane,
        package_label: input.packageLabel,
        title: input.title,
        wizard_step_key: input.wizardStepKey,
        reporting_period_month: input.reportingPeriodMonth,
        sections: input.sections,
      },
      context.actor,
    );

    /*
     * The saved draft is what a refresh or a resume reads back, so both the
     * list and this report are invalidated. This is the whole difference
     * between a draft and unsaved React state.
     */
    revalidatePath("/reporting");
    revalidatePath(`/reporting/${input.reportId}`);

    return { ok: true };
  } catch (error) {
    return { ok: false, error: toClientSafeError(error).message };
  }
}

export async function sendReportDraftAction(input: {
  requestId: string;
  reportId: string;
}): Promise<SaveReportDraftResult> {
  try {
    const context = await getInternalContext();
    await context.services.permissions.requireModuleAccess("reporting");

    await enforceServerCostLimit({
      actorId: context.actor.id,
      action: "report.send",
    });

    await context.services.reporting.sendDraft(
      { request_id: input.requestId, report_id: input.reportId },
      context.actor,
    );

    revalidatePath("/reporting");
    revalidatePath(`/reporting/${input.reportId}`);
    // A different session's pages, but they are rendered per request anyway.
    revalidatePath("/account/reporting");

    return { ok: true };
  } catch (error) {
    return { ok: false, error: toClientSafeError(error).message };
  }
}

export async function discardReportDraftAction(input: {
  reportId: string;
}): Promise<SaveReportDraftResult> {
  try {
    const context = await getInternalContext();
    await context.services.reporting.discardDraft(input.reportId, context.actor);

    revalidatePath("/reporting");

    return { ok: true };
  } catch (error) {
    return { ok: false, error: toClientSafeError(error).message };
  }
}
