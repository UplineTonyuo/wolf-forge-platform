import type {
  SupervisedConversationListRow,
  SupervisedMessageRow,
  SupervisedMessageType,
  SupervisedMessageWindowRow,
  SupervisedParticipantRow,
  SupervisedReactionCountRow,
  SupervisedReplyRow,
  SupervisedSearchResponseRow,
  SupervisedSearchResultRow,
  SupervisedTranscriptPageRow,
} from "./schema";

/**
 * Pure row -> read-only supervisory model mapping. Nothing here queries,
 * infers permissions, unread state or presence, reconstructs deleted content,
 * or produces any voice playback reference: each field is exactly one the RPC
 * already returned.
 */

export type SupervisedParticipant = {
  profileId: string;
  displayName: string | null;
  avatarUrl: string | null;
  archived: boolean;
};

/** Metadata only — no preview, no unread count. */
export type SupervisedConversationSummary = {
  conversationId: string;
  kind: string;
  createdAt: string;
  lastMessageAt: string | null;
  participants: [SupervisedParticipant, SupervisedParticipant];
};

/** `(last_message_at, conversation_id)` keyset for the next list page. */
export type SupervisedConversationCursor = {
  beforeLastMessageAt: string | null;
  beforeConversationId: string;
};

export type SupervisedConversationPage = {
  conversations: SupervisedConversationSummary[];
  nextCursor: SupervisedConversationCursor | null;
};

/** `(created_at, message_id)` keyset shared by history and search. */
export type SupervisedMessageCursor = {
  beforeCreatedAt: string;
  beforeMessageId: string;
};

export type SupervisedAuthor = {
  profileId: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type SupervisedReplyDisplay = {
  messageId: string;
  authorProfileId: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  body: string | null;
  messageType: SupervisedMessageType | null;
  deletedForEveryone: boolean;
};

export type SupervisedReactionCount = {
  reactionCode: string;
  count: number;
};

export type SupervisedDeletion = {
  deletedAt: string | null;
  deletedByProfileId: string | null;
  deletedByName: string | null;
};

/**
 * One neutral message. A deleted message keeps the database tombstone body; a
 * voice message keeps the placeholder body plus `supervisoryNotice`, and has
 * no storage, duration or playback field by design.
 */
export type SupervisedMessage = {
  messageId: string;
  author: SupervisedAuthor & { archived: boolean };
  body: string;
  messageType: SupervisedMessageType;
  createdAt: string;
  reply: SupervisedReplyDisplay | null;
  forwarded: boolean;
  forwardedFromAuthorName: string | null;
  deletion: SupervisedDeletion | null;
  supervisoryNotice: string | null;
  reactions: SupervisedReactionCount[];
};

type SupervisedConversationHeader = {
  conversationId: string;
  kind: string;
  createdAt: string;
  lastMessageAt: string | null;
  participants: SupervisedParticipant[];
};

export type SupervisedTranscriptPage = SupervisedConversationHeader & {
  /** Chronological. */
  messages: SupervisedMessage[];
  hasMore: boolean;
  nextCursor: SupervisedMessageCursor | null;
};

export type SupervisedMessageWindow =
  | { found: false }
  | (SupervisedConversationHeader & {
      found: true;
      messages: SupervisedMessage[];
      hasMoreBefore: boolean;
      hasMoreAfter: boolean;
    });

export type SupervisedMessageSearchResult = {
  messageId: string;
  author: SupervisedAuthor;
  createdAt: string;
  /** Bounded, highlight-sentinel snippet — never the full body. */
  snippet: string;
};

export type SupervisedMessageSearchPage = {
  results: SupervisedMessageSearchResult[];
  hasMore: boolean;
  nextCursor: SupervisedMessageCursor | null;
};

function toParticipant(row: SupervisedParticipantRow): SupervisedParticipant {
  return {
    profileId: row.profile_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    archived: row.archived,
  };
}

function toMessageCursor(
  createdAt: string | null,
  messageId: string | null,
): SupervisedMessageCursor | null {
  return createdAt && messageId ? { beforeCreatedAt: createdAt, beforeMessageId: messageId } : null;
}

export function toSupervisedConversationSummary(
  row: SupervisedConversationListRow,
): SupervisedConversationSummary {
  return {
    conversationId: row.conversation_id,
    kind: row.conversation_kind,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    participants: [
      {
        profileId: row.participant_one_profile_id,
        displayName: row.participant_one_name,
        avatarUrl: row.participant_one_avatar_url,
        archived: row.participant_one_archived,
      },
      {
        profileId: row.participant_two_profile_id,
        displayName: row.participant_two_name,
        avatarUrl: row.participant_two_avatar_url,
        archived: row.participant_two_archived,
      },
    ],
  };
}

/**
 * The list RPC returns bare rows with no has-more flag. A full page means
 * there may be more, and the last row is the next keyset — exactly the cursor
 * the RPC's `(last_message_at DESC NULLS LAST, id DESC)` order consumes.
 */
export function toSupervisedConversationPage(
  rows: SupervisedConversationListRow[],
  pageLimit: number,
): SupervisedConversationPage {
  const last = rows.length >= pageLimit ? rows[rows.length - 1] : undefined;
  return {
    conversations: rows.map(toSupervisedConversationSummary),
    nextCursor: last
      ? { beforeLastMessageAt: last.last_message_at, beforeConversationId: last.conversation_id }
      : null,
  };
}

function toReply(row: SupervisedReplyRow): SupervisedReplyDisplay {
  return {
    messageId: row.message_id,
    authorProfileId: row.author_profile_id,
    authorName: row.author_name,
    authorAvatarUrl: row.author_avatar_url,
    body: row.body,
    messageType: row.message_type,
    deletedForEveryone: row.deleted_for_everyone,
  };
}

function toReaction(row: SupervisedReactionCountRow): SupervisedReactionCount {
  return { reactionCode: row.reaction_code, count: row.reaction_count };
}

export function toSupervisedMessage(row: SupervisedMessageRow): SupervisedMessage {
  return {
    messageId: row.message_id,
    author: {
      profileId: row.author_profile_id,
      displayName: row.author_name,
      avatarUrl: row.author_avatar_url,
      archived: row.author_archived,
    },
    body: row.body,
    messageType: row.message_type,
    createdAt: row.created_at,
    reply: row.reply ? toReply(row.reply) : null,
    forwarded: row.forwarded,
    forwardedFromAuthorName: row.forwarded_from_author_name,
    deletion: row.deleted_for_everyone
      ? {
          deletedAt: row.deleted_for_everyone_at,
          deletedByProfileId: row.deleted_by_profile_id,
          deletedByName: row.deleted_by_name,
        }
      : null,
    supervisoryNotice: row.supervisory_notice,
    reactions: (row.reactions ?? []).map(toReaction),
  };
}

export function toSupervisedTranscriptPage(
  row: SupervisedTranscriptPageRow,
): SupervisedTranscriptPage {
  return {
    conversationId: row.conversation_id,
    kind: row.conversation_kind,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    participants: (row.participants ?? []).map(toParticipant),
    messages: (row.messages ?? []).map(toSupervisedMessage),
    hasMore: row.has_more,
    nextCursor: toMessageCursor(row.next_before_created_at, row.next_before_message_id),
  };
}

export function toSupervisedMessageWindow(
  row: SupervisedMessageWindowRow,
): SupervisedMessageWindow {
  if (!row.found) return { found: false };
  return {
    found: true,
    conversationId: row.conversation_id,
    kind: row.conversation_kind,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    participants: (row.participants ?? []).map(toParticipant),
    messages: (row.messages ?? []).map(toSupervisedMessage),
    hasMoreBefore: row.has_more_before,
    hasMoreAfter: row.has_more_after,
  };
}

function toSearchResult(row: SupervisedSearchResultRow): SupervisedMessageSearchResult {
  return {
    messageId: row.id,
    author: {
      profileId: row.author_profile_id,
      displayName: row.author_name,
      avatarUrl: row.author_avatar_url,
    },
    createdAt: row.created_at,
    snippet: row.snippet,
  };
}

export function toSupervisedMessageSearchPage(
  row: SupervisedSearchResponseRow,
): SupervisedMessageSearchPage {
  return {
    results: (row.results ?? []).map(toSearchResult),
    hasMore: row.has_more,
    nextCursor: toMessageCursor(row.next_before_created_at, row.next_before_message_id),
  };
}
