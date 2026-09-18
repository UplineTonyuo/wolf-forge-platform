import type {
  AssignTicketInput,
  CreateTicketInput,
  TicketDetail,
  TicketAttachmentSubmission,
  TicketAttachmentTarget,
  TicketForwardToTeamInput,
  TicketMessageInput,
  TicketReactionInput,
  TicketReactionToggle,
  TicketReplyToMessageInput,
  TicketSummary,
  UpdateTicketPriorityInput,
  UpdateTicketStatusInput,
} from "../domain/tickets/schema";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type { Json } from "../lib/supabase/database.types";
import type { TicketMessageRow, TicketRow } from "../lib/supabase/database-rows";
import { unwrapOne } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

export class TicketRepository {
  constructor(private readonly client: UserMutationClient) {}

  async getForOrder(orderId: string): Promise<TicketDetail | null> {
    const result = await this.client.rpc("app_get_order_conversation", { p_order_id: orderId });
    if (result.error) throw mapDatabaseError(result.error, "Order conversation");
    return result.data as TicketDetail | null;
  }

  async prepareAttachment(input: TicketAttachmentTarget): Promise<{ storage_key: string }> {
    // Cast inline at the call site — extracting `this.client.rpc` into a
    // variable first (the previous shape here) detaches it from `this.client`,
    // and supabase-js's rpc() needs that binding internally.
    const result = await (this.client.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>)("app_prepare_ticket_attachment", {
      p_request_id: input.request_id,
      p_ticket_id: input.ticket_id ?? undefined,
      p_order_id: input.order_id ?? undefined,
      p_reply_to_message_id: input.reply_to_message_id ?? undefined,
    });
    if (result.error) throw mapDatabaseError(result.error, "Ticket attachment");
    return result.data as { storage_key: string };
  }

  async sendWithAttachment(input: TicketAttachmentSubmission): Promise<{ ticket_id: string; message_id: string; attachment_id: string }> {
    const result = await (this.client.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>)("app_send_ticket_message_with_attachment", {
      p_request_id: input.request_id,
      p_ticket_id: input.ticket_id ?? undefined,
      p_order_id: input.order_id ?? undefined,
      p_body: input.body,
      p_reply_to_message_id: input.reply_to_message_id ?? undefined,
      p_original_name: input.attachment.original_name,
      p_mime_type: input.attachment.mime_type,
      p_size_bytes: input.attachment.size_bytes,
      p_checksum_sha256: input.attachment.checksum_sha256,
    });
    if (result.error) throw mapDatabaseError(result.error, "Ticket attachment");
    return result.data as { ticket_id: string; message_id: string; attachment_id: string };
  }

  async attachmentDownload(attachmentId: string): Promise<{ storage_object_key: string; mime_type: string; original_name: string }> {
    const result = await (this.client.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>)("app_get_ticket_attachment_download", { p_attachment_id: attachmentId });
    if (result.error) throw mapDatabaseError(result.error, "Ticket attachment");
    return result.data as { storage_object_key: string; mime_type: string; original_name: string };
  }

  async sendForOrder(orderId: string, input: TicketMessageInput, internalNote: boolean): Promise<string> {
    const result = await this.client.rpc("app_send_order_message", {
      p_order_id: orderId, p_request_id: input.request_id, p_body: input.body, p_internal_note: internalNote,
    });
    if (result.error) throw mapDatabaseError(result.error, "Order message");
    return result.data as string;
  }

  async replyToMessage(id: string, input: TicketReplyToMessageInput): Promise<TicketMessageRow> {
    return unwrapOne(
      await this.client.rpc("app_reply_to_ticket_message", {
        p_request_id: input.request_id,
        p_ticket_id: id,
        p_body: input.body,
        p_reply_to_message_id: input.reply_to_message_id,
        p_reply_to_attachment_id: input.reply_to_attachment_id ?? undefined,
      }),
      "Ticket reply",
    ) as TicketMessageRow;
  }

  async toggleReaction(input: TicketReactionInput): Promise<TicketReactionToggle> {
    const result = await this.client.rpc("app_toggle_ticket_message_reaction", {
      p_message_id: input.message_id,
      p_reaction_code: input.reaction_code,
    });
    if (result.error) throw mapDatabaseError(result.error, "Reaction");
    return result.data as unknown as TicketReactionToggle;
  }

  async forwardToTeam(input: TicketForwardToTeamInput): Promise<void> {
    const result = await this.client.rpc("app_forward_ticket_message_to_team", {
      p_request_id: input.request_id,
      p_source_ticket_message_id: input.source_message_id,
      p_destination_conversation_id: input.destination_conversation_id,
      p_comment: input.comment ?? undefined,
    });
    if (result.error) throw mapDatabaseError(result.error, "Forward");
  }

  async list(includeArchived = false): Promise<TicketSummary[]> {
    const result = await this.client.rpc("app_list_ticket_summaries", {
      p_include_archived: includeArchived,
    });
    if (result.error) throw mapDatabaseError(result.error, "Tickets");
    return (result.data ?? []) as TicketSummary[];
  }

  /**
   * The Inbox Tickets pane's own read. Same row shape as list(), narrowed
   * server-side to Tickets whose conversation is durably in the Inbox
   * (inbox_added_at is not null), so the pane never fetches Tickets it can
   * never render.
   */
  async listInbox(): Promise<TicketSummary[]> {
    const result = await this.client.rpc("app_list_ticket_summaries", {
      p_include_archived: false,
      p_inbox_only: true,
    });
    if (result.error) throw mapDatabaseError(result.error, "Tickets");
    return (result.data ?? []) as TicketSummary[];
  }

  async getById(id: string): Promise<TicketDetail> {
    const result = await this.client.rpc("app_get_ticket_detail_with_avatars", { p_ticket_id: id });
    if (result.error) throw mapDatabaseError(result.error, "Ticket");
    if (result.data == null) throw mapDatabaseError({ code: "PGRST116" }, "Ticket");
    return result.data as TicketDetail;
  }

  async create(input: CreateTicketInput): Promise<TicketRow> {
    const { request_id: requestId, ...payload } = input;
    return unwrapOne(
      await this.client.rpc("app_create_ticket", {
        p_request_id: requestId,
        p_payload: payload as Json,
      }),
      "Ticket",
    ) as TicketRow;
  }

  async reply(id: string, input: TicketMessageInput): Promise<TicketMessageRow> {
    return unwrapOne(
      await this.client.rpc("app_reply_to_ticket", {
        p_request_id: input.request_id,
        p_ticket_id: id,
        p_body: input.body,
      }),
      "Ticket reply",
    ) as TicketMessageRow;
  }

  async addInternalNote(id: string, input: TicketMessageInput): Promise<TicketMessageRow> {
    return unwrapOne(
      await this.client.rpc("app_add_ticket_internal_note", {
        p_request_id: input.request_id,
        p_ticket_id: id,
        p_body: input.body,
      }),
      "Ticket note",
    ) as TicketMessageRow;
  }

  async unsendInternalNote(messageId: string): Promise<{ ticket_id: string; order_id: string | null }> {
    const result = await this.client.rpc("app_unsend_ticket_internal_note", { p_message_id: messageId });
    if (result.error) throw mapDatabaseError(result.error, "Ticket note");
    return result.data as { ticket_id: string; order_id: string | null };
  }

  async updateStatus(id: string, input: UpdateTicketStatusInput): Promise<TicketRow> {
    return unwrapOne(
      await this.client.rpc("app_update_ticket_status", {
        p_ticket_id: id,
        p_status: input.status,
      }),
      "Ticket",
    ) as TicketRow;
  }

  async updatePriority(id: string, input: UpdateTicketPriorityInput): Promise<TicketRow> {
    return unwrapOne(
      await this.client.rpc("app_update_ticket_priority", {
        p_ticket_id: id,
        p_priority: input.priority,
      }),
      "Ticket",
    ) as TicketRow;
  }

  async assign(id: string, input: AssignTicketInput): Promise<TicketRow> {
    return unwrapOne(
      await this.client.rpc("app_assign_ticket", {
        p_ticket_id: id,
        p_assigned_to_profile_id: input.assigned_to_profile_id ?? undefined,
      }),
      "Ticket",
    ) as TicketRow;
  }

  async archive(id: string): Promise<TicketRow> {
    return unwrapOne(
      await this.client.rpc("app_archive_ticket", { p_ticket_id: id }),
      "Ticket",
    ) as TicketRow;
  }

  async addToInbox(id: string): Promise<TicketRow> {
    return unwrapOne(
      await this.client.rpc("app_add_ticket_to_inbox", { p_ticket_id: id }),
      "Ticket",
    ) as TicketRow;
  }
}
