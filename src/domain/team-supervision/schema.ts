import { z } from "zod";
import { isCorrelationId } from "../security/correlation-id";
import { nonBlankTextSchema, timestampSchema, uuidSchema } from "../shared";
import { teamSearchQueryMaxLength } from "../team/schema";

/**
 * Team supervision: READ-ONLY supervisory access to internal direct
 * conversations for Owner/Admin actors holding `team_messages.supervise`.
 *
 * A separate security domain from participant Team messaging (`../team`). The
 * supervisor is never a conversation member, so nothing here carries
 * participant state: no unread/read markers, deliveries, notifications,
 * presence, typing, capabilities, reacted-by-me, hidden-for-me or voice
 * storage. Authorization, direct-only eligibility, limits and audit are all
 * enforced inside the `app_*_team_supervised_*` RPCs; the bounds below only
 * mirror them so an obviously invalid request never reaches the database.
 */

export const teamSupervisionListMaxLimit = 100;
export const teamSupervisionTranscriptMaxLimit = 100;
export const teamSupervisionWindowSideMaxLimit = 100;
export const teamSupervisionSearchMaxLimit = 50;
/** The list RPC default. Needed here only to decide whether a page was full. */
export const teamSupervisionListDefaultLimit = 50;

/** The audit helper's canonical shape: 32 lowercase hex characters. */
const correlationIdSchema = z.string().refine(isCorrelationId).optional();

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

/**
 * `(last_message_at DESC NULLS LAST, conversation_id DESC)` keyset. A
 * conversation with no messages has a null timestamp, so the id alone is a
 * valid cursor; a timestamp without an id is not.
 */
export const listSupervisedConversationsSchema = z
  .object({
    limit: z.number().int().min(1).max(teamSupervisionListMaxLimit).optional(),
    beforeLastMessageAt: timestampSchema.nullable().optional(),
    beforeConversationId: uuidSchema.nullable().optional(),
  })
  .refine((value) => !value.beforeLastMessageAt || Boolean(value.beforeConversationId), {
    message: "A timestamp cursor requires a conversation id.",
  });
export type ListSupervisedConversationsInput = z.infer<typeof listSupervisedConversationsSchema>;

export const getSupervisedConversationSchema = z.object({
  conversationId: uuidSchema,
  limit: z.number().int().min(1).max(teamSupervisionTranscriptMaxLimit).optional(),
  correlationId: correlationIdSchema,
});
export type GetSupervisedConversationInput = z.infer<typeof getSupervisedConversationSchema>;

/** Strict `(created_at, message_id)` earlier-than keyset — never OFFSET. */
export const listSupervisedMessagesBeforeSchema = z.object({
  conversationId: uuidSchema,
  beforeCreatedAt: timestampSchema,
  beforeMessageId: uuidSchema,
  limit: z.number().int().min(1).max(teamSupervisionTranscriptMaxLimit).optional(),
  correlationId: correlationIdSchema,
});
export type ListSupervisedMessagesBeforeInput = z.infer<
  typeof listSupervisedMessagesBeforeSchema
>;

export const getSupervisedMessageWindowSchema = z.object({
  conversationId: uuidSchema,
  targetMessageId: uuidSchema,
  beforeLimit: z.number().int().min(0).max(teamSupervisionWindowSideMaxLimit).optional(),
  afterLimit: z.number().int().min(0).max(teamSupervisionWindowSideMaxLimit).optional(),
  correlationId: correlationIdSchema,
});
export type GetSupervisedMessageWindowInput = z.infer<typeof getSupervisedMessageWindowSchema>;

/** One explicitly selected conversation. There is no cross-conversation search. */
export const searchSupervisedConversationSchema = z
  .object({
    conversationId: uuidSchema,
    query: nonBlankTextSchema.max(teamSearchQueryMaxLength),
    beforeCreatedAt: timestampSchema.nullable().optional(),
    beforeMessageId: uuidSchema.nullable().optional(),
    limit: z.number().int().min(1).max(teamSupervisionSearchMaxLimit).optional(),
    correlationId: correlationIdSchema,
  })
  .refine((value) => !value.beforeCreatedAt === !value.beforeMessageId, {
    message: "A search cursor needs both created_at and message id.",
  });
export type SearchSupervisedConversationInput = z.infer<
  typeof searchSupervisedConversationSchema
>;

// -----------------------------------------------------------------------------
// Rows, as the RPCs return them.
//
// The generated types report every `returns table` column non-null and every
// jsonb result as `Json`. These restate what the migrations actually return.
// -----------------------------------------------------------------------------

export type SupervisedConversationListRow = {
  conversation_id: string;
  conversation_kind: string;
  created_at: string;
  last_message_at: string | null;
  participant_one_profile_id: string;
  participant_one_name: string | null;
  participant_one_avatar_url: string | null;
  participant_one_archived: boolean;
  participant_two_profile_id: string;
  participant_two_name: string | null;
  participant_two_avatar_url: string | null;
  participant_two_archived: boolean;
};

export type SupervisedParticipantRow = {
  profile_id: string;
  display_name: string | null;
  avatar_url: string | null;
  archived: boolean;
};

export type SupervisedMessageType = "text" | "voice" | "task_activity" | "governance_activity";

export type SupervisedReplyRow = {
  message_id: string;
  author_profile_id: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  /** Quote text, or the database's "Message deleted" / "Voice message" placeholder. */
  body: string | null;
  message_type: SupervisedMessageType | null;
  deleted_for_everyone: boolean;
};

export type SupervisedReactionCountRow = {
  reaction_code: string;
  reaction_count: number;
};

/** `private.team_supervision_message_json()` — the one neutral message projection. */
export type SupervisedMessageRow = {
  message_id: string;
  author_profile_id: string;
  author_name: string | null;
  author_avatar_url: string | null;
  author_archived: boolean;
  /** Canonical body, or the database tombstone / voice placeholder. */
  body: string;
  message_type: SupervisedMessageType;
  created_at: string;
  reply: SupervisedReplyRow | null;
  forwarded: boolean;
  forwarded_from_author_name: string | null;
  deleted_for_everyone: boolean;
  deleted_for_everyone_at: string | null;
  deleted_by_profile_id: string | null;
  deleted_by_name: string | null;
  /** "Unavailable in supervisory view" for an undeleted voice message; else null. */
  supervisory_notice: string | null;
  reactions: SupervisedReactionCountRow[];
};

type SupervisedConversationHeaderRow = {
  conversation_id: string;
  conversation_kind: string;
  created_at: string;
  last_message_at: string | null;
  participants: SupervisedParticipantRow[];
  messages: SupervisedMessageRow[];
};

/** Detail and history share this envelope. */
export type SupervisedTranscriptPageRow = SupervisedConversationHeaderRow & {
  has_more: boolean;
  next_before_created_at: string | null;
  next_before_message_id: string | null;
};

/** A target outside the requested conversation is the same safe not-found. */
export type SupervisedMessageWindowRow =
  | { found: false; messages: [] }
  | (SupervisedConversationHeaderRow & {
      found: true;
      has_more_before: boolean;
      has_more_after: boolean;
    });

/** `snippet` carries private-use highlight sentinels, never HTML. */
export type SupervisedSearchResultRow = {
  id: string;
  author_profile_id: string;
  author_name: string | null;
  author_avatar_url: string | null;
  created_at: string;
  snippet: string;
};

export type SupervisedSearchResponseRow = {
  results: SupervisedSearchResultRow[];
  has_more: boolean;
  next_before_created_at: string | null;
  next_before_message_id: string | null;
};
