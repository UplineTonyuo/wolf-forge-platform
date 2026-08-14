import type { TicketPriority, TicketStatus } from "./types";

export const ticketStatusLabels: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_client: "Waiting on client",
  waiting_on_team: "Waiting on team",
  resolved: "Resolved",
  closed: "Closed",
};

export const ticketPriorityLabels: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const ticketStatusOptions = Object.entries(ticketStatusLabels) as Array<[TicketStatus, string]>;
export const ticketPriorityOptions = Object.entries(ticketPriorityLabels) as Array<[TicketPriority, string]>;

export function ticketActorLabel(authorType: string, authorName: string | null): string {
  if (authorName) return authorName;
  if (authorType === "guest") return "Contact Form guest";
  if (authorType === "system") return "Wolf Forge system";
  return authorType === "client" ? "Client" : "Wolf Forge";
}
