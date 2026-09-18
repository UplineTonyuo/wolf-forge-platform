/**
 * Phase 2 native Project conversation read model, as
 * `app_get_project_conversation` returns it (project_messages /
 * project_message_reactions). This is a deliberately separate shape from
 * `TicketDetail`/`TicketDetailMessage` (src/domain/tickets/schema.ts): Ticket
 * messages carry visibility/message_kind/unsent_at and a guest author type
 * that project_messages does not have, so a shared base type would be
 * optional-everything for no benefit. Not yet consumed by any page or
 * component -- the Ticket-backed read model remains the live production path.
 */

export type ProjectConversationAttachment = {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  scan_status: "pending" | "clean" | "rejected";
  created_at: string;
};

export type ProjectConversationReaction = {
  reaction_code: string;
  reaction_count: number;
  reacted_by_me: boolean;
  reactor_names: string[];
};

export type ProjectConversationMessage = {
  id: string;
  order_id: string;
  author_profile_id: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  author_type: "internal" | "client" | "system";
  body: string;
  created_at: string;
  reply_to_message_id: string | null;
  reply_quote_text: string | null;
  reply_to_attachment_id: string | null;
  attachments: ProjectConversationAttachment[];
  reactions: ProjectConversationReaction[];
};

export type ProjectConversation = {
  order_id: string;
  messages: ProjectConversationMessage[];
};
