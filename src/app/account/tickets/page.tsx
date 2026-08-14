import type { Metadata } from "next";
import { ClientTickets } from "../../../components/tickets/client-tickets";
import type { ClientTicketSummary } from "../../../domain/tickets/schema";
import { getClientContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Tickets" };

export default async function ClientTicketsPage() {
  const context = await getClientContext();
  const summaries = await context.services.tickets.list();
  const clientSummaries: ClientTicketSummary[] = summaries.map((ticket) => ({
    ticket_id: ticket.ticket_id,
    public_ref: ticket.public_ref,
    subject: ticket.subject,
    status: ticket.status,
    message_count: ticket.message_count,
    last_message_at: ticket.last_message_at,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    archived_at: ticket.archived_at,
  }));
  return <ClientTickets summaries={clientSummaries} />;
}
