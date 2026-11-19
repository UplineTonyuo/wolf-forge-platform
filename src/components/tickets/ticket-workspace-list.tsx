"use client";

import { TicketIcon } from "lucide-react";
import type { TicketSummary } from "../../domain/tickets/schema";
import { ticketStatusLabels } from "../../lib/tickets/presentation";
import { RouteTransitionLink as Link } from "../shell/route-transition";
import { TicketPagination, useTicketPagination } from "./ticket-pagination";
import styles from "./tickets.module.css";

export function TicketWorkspaceList({ summaries, ticketId }: { summaries: TicketSummary[]; ticketId: string }) {
  const pagination = useTicketPagination(summaries.length, summaries.findIndex((ticket) => ticket.ticket_id === ticketId));
  const pageTickets = summaries.slice(pagination.start, pagination.end);

  return (
    <aside className={styles.ticketWorkspaceList} aria-label="Tickets">
      {pageTickets.map((summary) => (
        <Link
          key={summary.ticket_id}
          href={`/tickets/${summary.ticket_id}`}
          className={[
            styles.ticketWorkspaceListItem,
            summary.ticket_id === ticketId ? styles.ticketWorkspaceListItemActive : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-current={summary.ticket_id === ticketId ? "page" : undefined}
        >
          <TicketIcon aria-hidden="true" className={styles.ticketWorkspaceListIcon} />
          <span className={styles.ticketWorkspaceListBody}>
            <span className={styles.ticketWorkspaceListSubject}>{summary.subject}</span>
            {summary.inbox_added_at ? (
              <span className={styles.inboxTag}>In Inbox</span>
            ) : null}
            <span className={styles.ticketWorkspaceListMeta}>
              {summary.company_name ?? summary.client_name ?? "Contact Form guest"}
            </span>
            <span className={styles.ticketWorkspaceListStatus}>
              {ticketStatusLabels[summary.status]}
            </span>
          </span>
        </Link>
      ))}
      <TicketPagination {...pagination} />
    </aside>
  );
}
