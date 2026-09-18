"use client";

import { AlertCircle, Loader2, TicketIcon } from "lucide-react";
import type { TicketSummary } from "../../domain/tickets/schema";
import { formatTeamRelativeTime } from "../../domain/team/projections";
import { ticketStatusLabels } from "../../lib/tickets/presentation";
import styles from "./team-messages.module.css";

/**
 * The Inbox drawer's Tickets pane: a lightweight list read from
 * `app_list_ticket_summaries` (see use-ticket-inbox-list.ts), never a
 * transcript. Selecting a row mounts the one live Ticket conversation for
 * that Ticket (see TeamMessagesDrawer's ticketDetail state) -- there is no
 * per-row live sync here, only this one list-level poll.
 *
 * Rows carry their own layout (.ticketRow) rather than reusing
 * `.conversationRow`, whose first track is the 34px avatar column a Team
 * conversation always fills. A Ticket row has no avatar, so that grid put the
 * whole body in the avatar track and clipped every subject.
 *
 * No unread affordance: `clientPortalUnreadIsSupported` is false and no
 * durable Ticket read marker exists. Inventing one here would be a fake.
 */
export function TeamTicketsPane({
  tickets,
  loading,
  error,
  activeTicketId,
  onSelect,
  onRetry,
}: {
  tickets: TicketSummary[];
  loading: boolean;
  error: string | null;
  activeTicketId: string | null;
  onSelect: (ticketId: string) => void;
  onRetry: () => void;
}) {
  const isEmpty = !loading && !error && tickets.length === 0;

  return (
    <div className={styles.ticketList} aria-label="Tickets" role="list">
      {loading ? (
        <div className={styles.paneHeaderActions} style={{ padding: "8px 12px" }}>
          <Loader2 aria-label="Refreshing" className={styles.spin} />
        </div>
      ) : null}

      {error ? (
        <div className={`${styles.stateBlock} ${styles.stateError}`}>
          <span className={styles.stateIcon}>
            <AlertCircle aria-hidden="true" />
          </span>
          <strong>Tickets could not be loaded</strong>
          <p>{error}</p>
          <button type="button" className={styles.secondaryButton} onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}

      {isEmpty ? (
        <div className={styles.stateBlock}>
          <span className={styles.stateIcon}>
            <TicketIcon aria-hidden="true" />
          </span>
          <strong>No Tickets yet</strong>
          <p>Client Tickets will appear here.</p>
        </div>
      ) : null}

      {tickets.map((ticket) => (
        <button
          key={ticket.ticket_id}
          type="button"
          role="listitem"
          className={[
            styles.ticketRow,
            activeTicketId === ticket.ticket_id ? styles.ticketRowActive : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-current={activeTicketId === ticket.ticket_id ? "true" : undefined}
          onClick={() => onSelect(ticket.ticket_id)}
        >
          <span className={styles.ticketRowSubject}>{ticket.subject}</span>
          <span className={styles.ticketRowClient}>
            {ticket.company_name ?? ticket.client_name ?? "Unlinked client"}
          </span>
          <span className={styles.ticketRowMeta}>
            <span className={styles.ticketRowStatus}>
              {ticketStatusLabels[ticket.status]}
            </span>
            {" · "}
            {formatTeamRelativeTime(ticket.last_message_at ?? ticket.updated_at)}
          </span>
        </button>
      ))}
    </div>
  );
}
