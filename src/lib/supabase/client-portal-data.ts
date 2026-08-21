import "server-only";

import { cache } from "react";
import {
  composeClientPortalSummary,
  type ClientNavCounts,
  type ClientPortalSources,
  type ClientPortalSummary,
} from "../../domain/client-portal/summary";
import { resolveWalletFunding } from "../../domain/client-portal/payment-method";
import type { FormAssignmentSummary } from "../../domain/forms/schema";
import {
  composeClientPaymentRails,
  type ClientPaymentRail,
} from "../../domain/payments/payment-rails";
import { readExternalPaymentRailAvailability } from "../payments/payment-rail-configuration";
import type { ClientProjectView } from "../../domain/orders/client-projections";
import type { SubscriptionSummary } from "../../domain/subscriptions/schema";
import type { ClientTicketSummary } from "../../domain/tickets/schema";
import type { ClientInvoiceSummary } from "../../repositories/invoice-repository";
import { getClientContext } from "./next-server";

/**
 * Shared client-portal reads.
 *
 * The rail shows real attention counts and the Dashboard shows the same facts
 * in full, so both need the same rows. Rather than a summary RPC duplicating
 * logic the domain layer already owns — and rather than the layout and the page
 * each querying independently — every read here is memoized with React cache()
 * for the lifetime of one request. The rail pulls three of them; the Dashboard
 * pulls five; on the Dashboard route the overlap costs nothing.
 *
 * Authorization is unchanged and is not performed here. Each read is gated on
 * the account's own module grants from app_current_user_modules(), and every
 * underlying RPC re-derives the caller from auth.uid() with RLS deciding rows.
 * A module the account does not hold is skipped rather than attempted-and-
 * caught, so a denied section is absent rather than error-shaped, and resolves
 * to null: "this section does not exist" rather than "this section is empty".
 */
async function whenGranted<T>(
  granted: boolean | undefined,
  read: () => Promise<T>,
): Promise<T | null> {
  if (granted !== true) return null;
  return read();
}

export const readClientProjects = cache(async (): Promise<ClientProjectView[] | null> => {
  const context = await getClientContext();
  return whenGranted(context.user.modules.portal_projects, () =>
    context.services.projects.listClientProjects(),
  );
});

export const readClientAssignments = cache(async (): Promise<FormAssignmentSummary[] | null> => {
  const context = await getClientContext();
  return whenGranted(context.user.modules.portal_forms, () =>
    context.services.forms.listAssignments(),
  );
});

export const readClientInvoices = cache(async (): Promise<ClientInvoiceSummary[] | null> => {
  const context = await getClientContext();
  return whenGranted(context.user.modules.portal_invoices, () =>
    context.services.invoices.listForClient(),
  );
});

export const readClientSubscriptions = cache(async (): Promise<SubscriptionSummary[] | null> => {
  const context = await getClientContext();
  return whenGranted(context.user.modules.portal_subscriptions, () =>
    context.services.subscriptions.list(),
  );
});

/**
 * Conversations, reduced to the client-safe projection.
 *
 * The internal TicketSummary carries assignee identity, company identity and
 * priority. Narrowing happens here, at the edge, so nothing downstream in the
 * portal is even able to render a field a client should not see.
 */
export const readClientTickets = cache(async (): Promise<ClientTicketSummary[] | null> => {
  const context = await getClientContext();
  const summaries = await whenGranted(context.user.modules.portal_tickets, () =>
    context.services.tickets.list(),
  );

  return (
    summaries?.map((ticket) => ({
      ticket_id: ticket.ticket_id,
      public_ref: ticket.public_ref,
      subject: ticket.subject,
      status: ticket.status,
      message_count: ticket.message_count,
      last_message_at: ticket.last_message_at,
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
      archived_at: ticket.archived_at,
    })) ?? null
  );
});

export async function getClientPortalSources(): Promise<ClientPortalSources> {
  const [projects, assignments, invoices, tickets, subscriptions] = await Promise.all([
    readClientProjects(),
    readClientAssignments(),
    readClientInvoices(),
    readClientTickets(),
    readClientSubscriptions(),
  ]);

  return { projects, assignments, invoices, tickets, subscriptions };
}

export async function getClientPortalSummary(): Promise<ClientPortalSummary> {
  return composeClientPortalSummary(await getClientPortalSources());
}

/**
 * Reports this person has not opened.
 *
 * Its own read rather than part of the summary sources: read state is per
 * profile while every other source is per company, and the RPC already returns
 * 0 for an account without the Reporting grant, so the rail can ask
 * unconditionally.
 */
export const readUnreadReportCount = cache(async (): Promise<number> => {
  const context = await getClientContext();
  if (context.user.modules.portal_reporting !== true) return 0;
  return context.services.reporting.countUnread();
});

/**
 * How this account can pay, for surfaces that only need to *show* it.
 *
 * Gated on `portal_invoices` rather than a module of its own: paying is part of
 * the account's billing surface, which is the same reasoning
 * `/account/payment-method` already uses. An account without that grant gets
 * null and the Dashboard omits the zone rather than rendering an empty one.
 *
 * Every input is server-derived. The company comes from
 * `app_get_client_account_context` via the verified session, never from the
 * browser; the balance comes from `public.company_wallets` under RLS; the
 * external rails' availability comes from server configuration through a
 * `server-only` module. Nothing a client sends can reach any of them, which is
 * what makes a forged balance or a forged "PayPal is connected" impossible.
 */
export const readClientPaymentRails = cache(async (): Promise<ClientPaymentRail[] | null> => {
  const context = await getClientContext();

  return whenGranted(context.user.modules.portal_invoices, async () => {
    const [wallet, membership] = await Promise.all([
      context.services.wallets.getForCompany(context.user.companyId),
      context.services.wfCard.getMembership(context.user.companyId),
    ]);

    return composeClientPaymentRails({
      /*
       * A missing wallet row reads as a zero balance rather than as an error:
       * the Dashboard is a summary, and "$0.00 available" is both true and
       * useless to break a page over. The Payment method page keeps its own
       * stricter read, because that page is *about* the wallet.
       */
      wallet: resolveWalletFunding({
        membershipStatus: membership?.status ?? null,
        balanceCents: wallet?.balance_cents ?? 0,
        currency: wallet?.currency ?? "USD",
      }),
      availability: readExternalPaymentRailAvailability(),
    });
  });
});

/**
 * The rail's counts only.
 *
 * Reads three resources rather than five: billing state is not something the
 * navigation counts, so Invoices and Subscriptions are not fetched on every
 * page just to render a rail.
 */
export async function getClientNavCounts(): Promise<ClientNavCounts> {
  const [projects, assignments, tickets, reporting] = await Promise.all([
    readClientProjects(),
    readClientAssignments(),
    readClientTickets(),
    readUnreadReportCount(),
  ]);

  const { counts } = composeClientPortalSummary({
    projects,
    assignments,
    tickets,
    invoices: null,
    subscriptions: null,
  });

  return { ...counts, reporting };
}
