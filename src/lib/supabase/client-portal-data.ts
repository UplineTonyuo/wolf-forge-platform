import "server-only";

import { cache } from "react";
import {
  composeClientPortalSummary,
  type ClientNavCounts,
  type ClientPortalSources,
  type ClientPortalSummary,
} from "../../domain/client-portal/summary";
import type { FormAssignmentSummary } from "../../domain/forms/schema";
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
 * The rail's counts only.
 *
 * Reads three resources rather than five: billing state is not something the
 * navigation counts, so Invoices and Subscriptions are not fetched on every
 * page just to render a rail.
 */
export async function getClientNavCounts(): Promise<ClientNavCounts> {
  const [projects, assignments, tickets] = await Promise.all([
    readClientProjects(),
    readClientAssignments(),
    readClientTickets(),
  ]);

  const { counts } = composeClientPortalSummary({
    projects,
    assignments,
    tickets,
    invoices: null,
    subscriptions: null,
  });

  return counts;
}
