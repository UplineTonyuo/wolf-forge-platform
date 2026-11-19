"use client";

import { AlertCircle, BellRing, ChevronLeft, ChevronRight, Search, TicketIcon, X } from "lucide-react";
import orderStyles from "../projects/projects-workspace.module.css";
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
  tickets, page, pages, query, onPageChange, onQueryChange,
  loading,
  error,
  activeTicketId,
  onSelect,
  onRetry,
}: {
  tickets: TicketSummary[];
  page: number;
  pages: number;
  query: string;
  onPageChange: (page: number) => void;
  onQueryChange: (query: string) => void;
  loading: boolean;
  error: string | null;
  activeTicketId: string | null;
  onSelect: (ticketId: string) => void;
  onRetry: () => void;
}) {
  const isEmpty = !loading && !error && tickets.length === 0;

  return (
    <div className={styles.ticketList}>
      <div className={styles.ticketSearch}>
        <Search aria-hidden="true" size={16} />
        <input type="search" aria-label="Search tickets" placeholder="Search reference, client, or title" value={query} onChange={(event) => onQueryChange(event.currentTarget.value)} />
        {query ? <button type="button" aria-label="Clear ticket search" onClick={() => onQueryChange("")}><X aria-hidden="true" size={16} /></button> : null}
      </div>
      {loading ? (
        /* First load: rows shaped like .ticketRow (subject, client, meta) instead of a spinner. */
        <div role="status" aria-label="Loading tickets">
          {Array.from({ length: 6 }, (_, row) => (
            <div className={`${styles.ticketRow} ${styles.ticketRowSkeleton}`} aria-hidden="true" key={row}>
              <span className={styles.ticketSkeletonTitle} style={{ width: "78%" }} />
              <span className={styles.ticketSkeletonRef} style={{ width: "46%" }} />
              <span className={styles.ticketSkeletonRef} style={{ width: "62%" }} />
            </div>
          ))}
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
          <strong>{query.trim() ? "No tickets found" : "No Tickets yet"}</strong>
          <p>{query.trim() ? "Try a different reference or client name." : "Client Tickets will appear here."}</p>
        </div>
      ) : null}

      <div role="list" aria-label="Tickets">
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
          {ticket.unanswered === true ? <span className={styles.ticketUnanswered}><BellRing aria-hidden="true" size={13} />Unanswered</span> : null}
          <span className={styles.ticketRowClient}>
            {ticket.company_name ?? ticket.client_name ?? "Unlinked client"}
          </span>
          <span className={styles.ticketRowMeta}>
            <span>{ticket.public_ref}</span>{" · "}
            <span className={styles.ticketRowStatus}>
              {ticketStatusLabels[ticket.status]}
            </span>
            {" · "}
            {formatTeamRelativeTime(ticket.last_message_at ?? ticket.updated_at)}
          </span>
        </button>
      ))}
      </div>
      {pages > 0 && (
        <nav className={`${orderStyles.pagination} ${styles.ticketPager}`} aria-label="Inbox ticket pages">
          <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
          <span aria-live="polite">Page {page} of {pages}</span>
          <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onPageChange(page + 1)}><ChevronRight size={16} aria-hidden="true" /></button>
        </nav>
      )}
    </div>
  );
}
