"use client";
import { useWorkflowLabels } from "../settings/workflow-labels";
import type { TicketPriority, TicketStatus } from "../../lib/tickets/types";
import { ticketPriorityLabels, ticketStatusLabels } from "../../lib/tickets/presentation";
import styles from "./tickets.module.css";

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const entry = useWorkflowLabels("tickets").find(e=>e.key===status);
  return <span className={styles.statusBadge} title={entry?.description} style={entry ? {borderInlineStart:"3px solid "+entry.color} : undefined} data-state={status}>{entry?.name ?? ticketStatusLabels[status]}</span>;
}

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return <span className={styles.priorityBadge} data-priority={priority}>{ticketPriorityLabels[priority]}</span>;
}
