import type { ticketPriorities, ticketStatuses } from "../../domain/tickets/schema";

export type TicketStatus = (typeof ticketStatuses)[number];
export type TicketPriority = (typeof ticketPriorities)[number];
