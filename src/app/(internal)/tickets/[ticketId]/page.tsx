import { CalendarDays, FileInput, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TicketAdminControls } from "../../../../components/tickets/ticket-admin-controls";
import { TicketComposer } from "../../../../components/tickets/ticket-composer";
import { TicketConversation } from "../../../../components/tickets/ticket-conversation";
import styles from "../../../../components/tickets/tickets.module.css";
import { PageFrame } from "../../../../components/ui/page-frame";
import { formatDateTime } from "../../../../lib/format";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Ticket Detail" };

export default async function TicketDetailPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const [{ ticketId }, context] = await Promise.all([params, getInternalContext()]);
  try {
    const [detail, assignees] = await Promise.all([context.services.tickets.get(ticketId), context.services.catalog.listAssignees()]);
    const ticket = detail.ticket;
    const repliesDisabled = ticket.status === "closed" || Boolean(ticket.archived_at);
    return <PageFrame title={ticket.subject} description={<>Ticket <strong>{ticket.public_ref}</strong></>}>
      <div className={styles.detailGrid}>
        <main className={styles.detailMain}>
          <TicketConversation messages={detail.messages} />
          {context.user.tickets.reply ? <TicketComposer ticketId={ticket.id} mode="admin" disabled={repliesDisabled} /> : null}
          {context.user.tickets.internalNotes ? <TicketComposer ticketId={ticket.id} mode="note" disabled={repliesDisabled} /> : null}
        </main>
        <aside className={styles.ticketSidebar} aria-label="Ticket details and controls">
          <section><h2>Ticket details</h2><dl className={styles.ticketMeta}><div><dt>Client / company</dt><dd>{detail.company_name ?? detail.client_name ?? ticket.requester_name ?? "Contact Form guest"}</dd></div>{detail.client_name && detail.company_name ? <div><dt>Contact</dt><dd>{detail.client_name}</dd></div> : null}<div><dt>Created</dt>
<dd className={styles.ticketDateValue}>
  <CalendarDays aria-hidden="true" />
  <span>{formatDateTime(ticket.created_at)}</span>
</dd></div><div><dt>Last activity</dt>
<dd className={styles.ticketDateValue}>
  <History aria-hidden="true" />
  <span>{formatDateTime(ticket.updated_at)}</span>
</dd></div>{ticket.resolved_at ? <div><dt>Resolved</dt><dd>{formatDateTime(ticket.resolved_at)}</dd></div> : null}{ticket.closed_at ? <div><dt>Closed</dt><dd>{formatDateTime(ticket.closed_at)}</dd></div> : null}</dl></section>
          {ticket.source_form_submission_id ? <section><div className={styles.sourceIndicator}><FileInput aria-hidden="true" /><div><strong>Contact Form source</strong>This Ticket was created from a submitted Contact Form. <Link href={`/forms/submissions/${ticket.source_form_submission_id}`}>View exact submission</Link></div></div></section> : null}
          <section><h2>Operations</h2><TicketAdminControls ticketId={ticket.id} status={ticket.status} priority={ticket.priority} assigneeId={ticket.assigned_to_profile_id ?? null} assignees={assignees} capabilities={context.user.tickets} /></section>
        </aside>
      </div>
    </PageFrame>;
  } catch (error) {
    if (toClientSafeError(error).code === "NOT_FOUND") notFound();
    throw error;
  }
}
