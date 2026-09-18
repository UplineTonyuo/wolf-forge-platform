import { z } from "zod";
import type {
  TicketAttachmentRow,
  TicketMessageRow,
  TicketRow,
} from "../../lib/supabase/database-rows";
import { nonBlankTextSchema, uuidSchema } from "../shared";
import {
  teamReactionCodeSchema,
  type TeamMessageReactionRow,
  type TeamReactionToggleRow,
} from "../team/schema";

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
  /*
   * Set only when the Ticket IS an Investment Intent conversation. It is the
   * sole durable discriminator: no source text, no entity string, and no
   * order_id. Optional, so every existing ordinary Ticket caller is unchanged.
   */
  investment_service_id: uuidSchema.optional(),
  subject: nonBlankTextSchema.max(500),
  message: ticketBodySchema,
  priority: z.enum(ticketPriorities).optional(),
});

export const ticketMessageInputSchema = z.object({
  request_id: uuidSchema,
  body: ticketBodySchema,
});

export const ticketAttachmentTargetSchema = z.object({
  request_id: uuidSchema,
  ticket_id: uuidSchema.nullable(),
  order_id: uuidSchema.nullable(),
  reply_to_message_id: uuidSchema.nullable(),
}).refine((value) => Boolean(value.ticket_id) !== Boolean(value.order_id), {
  message: "Choose exactly one Ticket attachment target.",
});

export const ticketAttachmentSubmissionSchema = ticketAttachmentTargetSchema.and(z.object({
  body: z.string().max(50_000),
  attachment: z.object({
    original_name: nonBlankTextSchema.max(255),
    mime_type: z.enum([
      "image/jpeg", "image/png", "image/webp", "image/gif",
      "video/mp4", "video/quicktime", "video/webm", "application/pdf",
    ]),
    size_bytes: z.number().int().positive().max(5 * 1024 * 1024),
    checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
}));

export const ticketReplyToMessageInputSchema = ticketMessageInputSchema.extend({
  reply_to_message_id: uuidSchema,
  reply_to_attachment_id: uuidSchema.nullable().optional(),
});

export const ticketReactionInputSchema = z.object({
  message_id: uuidSchema,
  reaction_code: teamReactionCodeSchema,
});

export const ticketForwardToTeamInputSchema = z.object({
  request_id: uuidSchema,
  source_message_id: uuidSchema,
  destination_conversation_id: uuidSchema,
  comment: z.string().max(1_000).nullable().optional(),
});

/**
 * The live lane's request. The browser supplies a Ticket id and the
 * fingerprint it already holds — never an actor, a company or a role. Who is
 * asking is derived from the session cookie inside the route, exactly as the
 * page render derives it.
 */
export const ticketLiveRequestSchema = z.object({
  ticket_id: uuidSchema,
  /* Bounded: it is a structural signature, never free text. */
  fingerprint: z.string().max(20_000).nullable(),
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
export type TicketAttachmentTarget = z.infer<typeof ticketAttachmentTargetSchema>;
export type TicketAttachmentSubmission = z.infer<typeof ticketAttachmentSubmissionSchema>;
export type TicketReplyToMessageInput = z.infer<typeof ticketReplyToMessageInputSchema>;
export type TicketReactionInput = z.infer<typeof ticketReactionInputSchema>;
export type TicketForwardToTeamInput = z.infer<typeof ticketForwardToTeamInputSchema>;
export type TicketReactionToggle = TeamReactionToggleRow;
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
  /** Durable Inbox conversation membership; null means the Ticket is managed from /tickets only. */
  inbox_added_at: string | null;
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
  reply_to_message_id?: string | null;
  reply_quote_text?: string | null;
  reply_source_author_name?: string | null;
  reply_source_available?: boolean;
  reply_to_attachment_id?: string | null;
  reply_source_attachment?: { id: string; is_image: boolean; original_name: string } | null;
  reactions?: TeamMessageReactionRow[];
  unsent_at?: string | null;
  can_unsend?: boolean;
  attachments: Array<Pick<TicketAttachmentRow, "id" | "original_name" | "mime_type" | "size_bytes" | "scan_status" | "created_at">>;
  /** Client-only optimistic-send bookkeeping; never present on rows from the server. */
  requestId?: string | null;
  pending?: boolean;
  failed?: boolean;
};

export type TicketDetailTicket = Pick<
  TicketRow,
  "id" | "public_ref" | "subject" | "status" | "priority" | "requester_name" | "created_at" | "updated_at" | "resolved_at" | "closed_at" | "archived_at"
> & Partial<Pick<TicketRow, "company_id" | "client_profile_id" | "assigned_to_profile_id" | "created_by_profile_id" | "source_form_submission_id" | "source_form_version_id" | "requester_email" | "inbox_added_at">>;

export type TicketDetail = {
  ticket: TicketDetailTicket;
  company_name: string | null;
  client_name: string | null;
  assigned_to_name: string | null;
  messages: TicketDetailMessage[];
};
