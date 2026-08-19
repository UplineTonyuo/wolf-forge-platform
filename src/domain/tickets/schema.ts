import { z } from "zod";
import type {
  TicketAttachmentRow,
  TicketMessageRow,
  TicketRow,
} from "../../lib/supabase/database-rows";
import { nonBlankTextSchema, uuidSchema } from "../shared";

export const ticketStatuses = [
  "open",
  "in_progress",
  "waiting_on_client",
  "waiting_on_team",
  "resolved",
  "closed",
] as const;
export const ticketPriorities = ["low", "normal", "high", "urgent"] as const;
export const ticketAuthorTypes = ["internal", "client", "guest", "system"] as const;
export const ticketMessageKinds = ["initial_request", "reply", "internal_note"] as const;
export const ticketVisibilities = ["client", "internal"] as const;

const ticketBodySchema = nonBlankTextSchema.max(50_000);

export const createTicketSchema = z.object({
  request_id: uuidSchema,
  company_id: uuidSchema.optional(),
  client_profile_id: uuidSchema.optional(),
  subject: nonBlankTextSchema.max(500),
  message: ticketBodySchema,
  priority: z.enum(ticketPriorities).optional(),
});

export const ticketMessageInputSchema = z.object({
  request_id: uuidSchema,
  body: ticketBodySchema,
});

export const updateTicketStatusSchema = z.object({
  status: z.enum(ticketStatuses),
});

export const updateTicketPrioritySchema = z.object({
  priority: z.enum(ticketPriorities),
});

export const assignTicketSchema = z.object({
  assigned_to_profile_id: uuidSchema.nullable(),
});

export type Ticket = TicketRow;
export type TicketMessage = TicketMessageRow;
export type TicketAttachment = TicketAttachmentRow;
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type TicketMessageInput = z.infer<typeof ticketMessageInputSchema>;
export type UpdateTicketStatusInput = z.infer<typeof updateTicketStatusSchema>;
export type UpdateTicketPriorityInput = z.infer<typeof updateTicketPrioritySchema>;
export type AssignTicketInput = z.infer<typeof assignTicketSchema>;

export type TicketSummary = {
  ticket_id: string;
  public_ref: string;
  company_id: string | null;
  company_name: string | null;
  client_profile_id: string | null;
  client_name: string | null;
  subject: string;
  status: (typeof ticketStatuses)[number];
  priority: (typeof ticketPriorities)[number];
  assigned_to_profile_id: string | null;
  assigned_to_name: string | null;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ClientTicketSummary = Pick<
  TicketSummary,
  "ticket_id" | "public_ref" | "subject" | "status" | "message_count" | "last_message_at" | "created_at" | "updated_at" | "archived_at"
>;

export type TicketCapabilities = {
  view: boolean;
  create: boolean;
  reply: boolean;
  edit: boolean;
  assign: boolean;
  internalNotes: boolean;
  archive: boolean;
};

export type TicketDetailMessage = {
  id: string;
  ticket_id: string;
  author_profile_id: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  author_type: (typeof ticketAuthorTypes)[number];
  message_kind: (typeof ticketMessageKinds)[number];
  visibility: (typeof ticketVisibilities)[number];
  body: string;
  created_at: string;
  attachments: Array<Pick<TicketAttachmentRow, "id" | "original_name" | "mime_type" | "size_bytes" | "scan_status" | "created_at">>;
};

export type TicketDetailTicket = Pick<
  TicketRow,
  "id" | "public_ref" | "subject" | "status" | "priority" | "requester_name" | "created_at" | "updated_at" | "resolved_at" | "closed_at" | "archived_at"
> & Partial<Pick<TicketRow, "company_id" | "client_profile_id" | "assigned_to_profile_id" | "created_by_profile_id" | "source_form_submission_id" | "source_form_version_id" | "requester_email">>;

export type TicketDetail = {
  ticket: TicketDetailTicket;
  company_name: string | null;
  client_name: string | null;
  assigned_to_name: string | null;
  messages: TicketDetailMessage[];
};
