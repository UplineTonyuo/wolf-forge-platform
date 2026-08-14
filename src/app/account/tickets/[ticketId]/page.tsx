import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TicketStatusBadge } from "../../../../components/tickets/ticket-badges";
import { TicketComposer } from "../../../../components/tickets/ticket-composer";
import { TicketConversation } from "../../../../components/tickets/ticket-conversation";
import styles from "../../../../components/tickets/tickets.module.css";
import { formatDateTime } from "../../../../lib/format";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { getClientContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Ticket" };

export default async function ClientTicketDetailPage({ params, searchParams }: { params: Promise<{ ticketId: string }>; searchParams: Promise<{ created?: string }> }) {
  const [{ ticketId }, query, context] = await Promise.all([params, searchParams, getClientContext()]);
  try {
    const detail = await context.services.tickets.get(ticketId);
    const ticket = detail.ticket;
    const repliesDisabled = ticket.status === "closed" || Boolean(ticket.archived_at);
    return <>
      {query.created ? <div className="success-banner">Your Ticket was created. Wolf Forge can now reply in this conversation.</div> : null}
      <header className={styles.clientDetailHeader}><div><Link href="/account/tickets">← All Tickets</Link><h1>{ticket.subject}</h1><p>{ticket.public_ref}</p></div><TicketStatusBadge status={ticket.status} /></header>
      <div className={styles.clientDetailGrid}>
        <main className={styles.detailMain}><TicketConversation messages={detail.messages} clientView /><TicketComposer ticketId={ticket.id} mode="client" disabled={repliesDisabled} /></main>
        <aside className={styles.clientSummary}><h2>Ticket summary</h2><dl><div><dt>Status</dt><dd><TicketStatusBadge status={ticket.status} /></dd></div><div><dt>Created</dt><dd>{formatDateTime(ticket.created_at)}</dd></div><div><dt>Last activity</dt><dd>{formatDateTime(ticket.updated_at)}</dd></div></dl></aside>
      </div>
    </>;
  } catch (error) {
    if (["NOT_FOUND", "FORBIDDEN"].includes(toClientSafeError(error).code)) notFound();
    throw error;
  }
}
