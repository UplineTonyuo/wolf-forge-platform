import type { TicketPriority, TicketStatus } from "../../lib/tickets/types";
import { ticketPriorityLabels, ticketStatusLabels } from "../../lib/tickets/presentation";
import styles from "./tickets.module.css";

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <span className={styles.statusBadge} data-state={status}>{ticketStatusLabels[status]}</span>;
}

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return <span className={styles.priorityBadge} data-priority={priority}>{ticketPriorityLabels[priority]}</span>;
}
