import { ArrowLeft, CalendarDays, History, MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AttentionPill } from "../../../../components/account/ui/attention-pill";
import { TicketClientConversation } from "../../../../components/tickets/ticket-client-conversation";
import { TicketAccessBoundary } from "../../../../components/tickets/ticket-access-boundary";
import styles from "../../../../components/tickets/tickets.module.css";
import { ticketAttention } from "../../../../domain/client-portal/attention";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { formatDateTime } from "../../../../lib/format";
import { getClientContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Ticket" };

export default async function ClientMessageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticketId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const [{ ticketId }, query, context] = await Promise.all([
    params,
    searchParams,
    getClientContext(),
  ]);

  try {
    /*
     * app_get_ticket_detail_with_avatars resolves access from auth.uid() and
     * returns only client-visible messages to a client account — internal notes
     * are excluded by ticket_messages_authorized_select, not by this component.
     */
    const detail = await context.services.tickets.get(ticketId);
    const ticket = detail.ticket;
    const attention = ticketAttention(ticket.status);
    const repliesDisabled = ticket.status === "closed" || Boolean(ticket.archived_at);

    return (
      <TicketAccessBoundary key={ticket.id}><div className="portal-page">
        <Link href="/account/messages" className="portal-back">
          <ArrowLeft aria-hidden={true} />
          All tickets
        </Link>

        {/*
          * Wolf Forge's own confirmation rather than a generic success alert.
          * The wording is unchanged; only the treatment is, and it sits on the
          * same left edge as the conversation below it.
          */}
        {query.created ? (
          <p className="portal-sent-banner" role="status">
            <MailCheck aria-hidden={true} />
            Your message was sent. Wolf Forge will reply in this conversation.
          </p>
        ) : null}

        <header className="portal-page-head portal-page-head-actions">
          <div>
            <span className="portal-eyebrow">{ticket.public_ref}</span>
            <h1>{ticket.subject}</h1>
          </div>
        </header>

        <div className={styles.clientDetailGrid}>
          <main className={styles.detailMain}>
            <TicketClientConversation
              ticketId={ticket.id}
              messages={detail.messages}
              viewerProfileId={context.user.id}
              repliesDisabled={repliesDisabled}
            />
          </main>

          <aside className={styles.clientSummary}>
            <h2>Conversation</h2>
            <dl>
              <div>
                <dt>Status</dt>
                <dd>
                  <AttentionPill tone={attention.tone} label={attention.label} />
                </dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd className={styles.ticketDateValue}>
                  <CalendarDays aria-hidden="true" />
                  <span>{formatDateTime(ticket.created_at)}</span>
                </dd>
              </div>
              <div>
                <dt>Last activity</dt>
                <dd className={styles.ticketDateValue}>
                  <History aria-hidden="true" />
                  <span>{formatDateTime(ticket.updated_at)}</span>
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      </div></TicketAccessBoundary>
    );
  } catch (error) {
    // A conversation outside the account is refused by the database, so it
    // arrives here as an error and becomes a 404 — the portal never confirms
    // that another company's conversation exists.
    if (["NOT_FOUND", "FORBIDDEN", "PERMISSION_DENIED"].includes(toClientSafeError(error).code)) {
      notFound();
    }
    throw error;
  }
}
