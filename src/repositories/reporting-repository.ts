import {
  clientReportDocumentSchema,
  internalReportDocumentSchema,
  type ClientReportDocument,
  type ClientReportRow,
  type CreateReportDraftInput,
  type InternalReportDocument,
  type InternalReportRow,
  type ReportingServiceOption,
  type SaveReportDraftInput,
  type SendClientReportInput,
  type SendReportDraftInput,
} from "../domain/reporting/schema";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type { Json } from "../lib/supabase/database.types";
import type { ClientReportDbRow } from "../lib/supabase/database-rows";
import { unwrapOne } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

/**
 * Reporting access.
 *
 * RPCs only. The send path is audited and internal; the read path derives the
 * company from the session inside the database, so no method here accepts a
 * company from its caller except the one an internal actor explicitly targets.
 */
export class ReportingRepository {
  constructor(private readonly client: UserMutationClient) {}

  async send(input: SendClientReportInput): Promise<ClientReportDbRow> {
    const { request_id: requestId, ...payload } = input;

    return unwrapOne(
      await this.client.rpc("app_send_client_report", {
        p_request_id: requestId,
        p_payload: payload as unknown as Json,
      }),
      "Client report",
    ) as ClientReportDbRow;
  }

  /** The caller's own company reports. Company is never passed in. */
  async listMine(limit?: number): Promise<ClientReportRow[]> {
    const result = await this.client.rpc(
      "app_list_my_client_reports",
      limit === undefined ? {} : { p_limit: limit },
    );

    if (result.error) throw mapDatabaseError(result.error, "Reporting");
    return (result.data ?? []) as unknown as ClientReportRow[];
  }

  /** One sent report for the caller's own company. Company is never passed in. */
  async getMine(reportId: string): Promise<ClientReportDocument> {
    const result = await this.client.rpc("app_get_my_client_report", {
      p_report_id: reportId,
    });

    if (result.error) throw mapDatabaseError(result.error, "Report");
    return clientReportDocumentSchema.parse(result.data);
  }

  async markRead(reportId: string): Promise<void> {
    const result = await this.client.rpc("app_mark_client_report_read", {
      p_report_id: reportId,
    });

    if (result.error) throw mapDatabaseError(result.error, "Report");
  }

  /** Zero when the module is denied, so the rail can ask unconditionally. */
  async countUnread(): Promise<number> {
    const result = await this.client.rpc("app_count_my_unread_reports");
    if (result.error) throw mapDatabaseError(result.error, "Reporting");
    return result.data ?? 0;
  }

  /* ---------------------------------------------------------------------------
   * The internal builder
   *
   * Every call below is re-authorized inside the database through the internal
   * reporting module and reports.send, and every report id is re-resolved
   * there rather than trusted. Nothing here grants access by being called.
   * ------------------------------------------------------------------------ */

  async createDraft(input: CreateReportDraftInput): Promise<ClientReportDbRow> {
    const { request_id: requestId, ...payload } = input;

    return unwrapOne(
      await this.client.rpc("app_create_report_draft", {
        p_request_id: requestId,
        p_payload: payload as unknown as Json,
      }),
      "Report draft",
    ) as ClientReportDbRow;
  }

  async saveDraft(input: SaveReportDraftInput): Promise<ClientReportDbRow> {
    const { report_id: reportId, ...payload } = input;

    return unwrapOne(
      await this.client.rpc("app_save_report_draft", {
        p_report_id: reportId,
        p_payload: payload as unknown as Json,
      }),
      "Report draft",
    ) as ClientReportDbRow;
  }

  async sendDraft(input: SendReportDraftInput): Promise<ClientReportDbRow> {
    return unwrapOne(
      await this.client.rpc("app_send_report_draft", {
        p_request_id: input.request_id,
        p_report_id: input.report_id,
      }),
      "Report",
    ) as ClientReportDbRow;
  }

  async discardDraft(reportId: string): Promise<void> {
    const result = await this.client.rpc("app_discard_report_draft", {
      p_report_id: reportId,
    });

    if (result.error) throw mapDatabaseError(result.error, "Report draft");
  }

  async listInternal(status?: "draft" | "sent", limit?: number): Promise<InternalReportRow[]> {
    const result = await this.client.rpc("app_list_internal_reports", {
      ...(status === undefined ? {} : { p_status: status }),
      ...(limit === undefined ? {} : { p_limit: limit }),
    });

    if (result.error) throw mapDatabaseError(result.error, "Reporting");
    return (result.data ?? []) as unknown as InternalReportRow[];
  }

  /**
   * One report and its whole structure.
   *
   * The document is re-parsed rather than cast. It arrives as untyped JSON, and
   * the builder edits it directly, so a shape that no longer matches should
   * fail here with a clear error rather than three components later.
   */
  async getInternal(reportId: string): Promise<InternalReportDocument> {
    const result = await this.client.rpc("app_get_internal_report", {
      p_report_id: reportId,
    });

    if (result.error) throw mapDatabaseError(result.error, "Report");
    return internalReportDocumentSchema.parse(result.data);
  }

  /**
   * Actual company subscriptions for supported Services, plus an explicit null
   * subscription row when the company has no relationship for that Service.
   */
  async listServiceOptions(
    companyId: string,
    supportedServiceIds: string[],
  ): Promise<ReportingServiceOption[]> {
    const result = await this.client.rpc("app_list_reporting_service_options", {
      p_company_id: companyId,
      p_supported_service_ids: supportedServiceIds,
    });

    if (result.error) throw mapDatabaseError(result.error, "Reporting Services");
    return (result.data ?? []) as ReportingServiceOption[];
  }

  async listReportedOneTimeDeliverables(input: {
    companyId: string;
    serviceId: string;
    subscriptionId: string | null;
  }): Promise<string[]> {
    const result = await this.client.rpc("app_list_reported_one_time_deliverables", {
      p_company_id: input.companyId,
      p_service_id: input.serviceId,
      ...(input.subscriptionId === null
        ? {}
        : { p_subscription_id: input.subscriptionId }),
    });

    if (result.error) throw mapDatabaseError(result.error, "One-time report items");
    return (result.data ?? []) as string[];
  }
}
