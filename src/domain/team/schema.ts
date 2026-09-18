import { z } from "zod";
import { nonBlankTextSchema, uuidSchema } from "../shared";

/**
 * Internal team communication.
 *
 * A separate security domain from the client Ticket system. Nothing in this
 * file describes a client: there is no company, no ticket status, no client
 * status and no Team Note. Those concepts belong to `domain/tickets`, which is
 * where staff talk *about* and *to* clients. This is where staff talk to each
 * other.
 *
 * Every schema here is an INPUT contract. Not one of them carries an author,
 * a sender or a creator: the database derives the acting profile from
 * auth.uid() inside each SECURITY DEFINER RPC, so there is deliberately no
 * field a browser could point at somebody else.
 */

// -----------------------------------------------------------------------------
// Vocabularies
// -----------------------------------------------------------------------------

/** Mirrors `team_tasks_status_valid`. */
export const teamTaskStatuses = ["todo", "in_progress", "done"] as const;
export const teamTaskStatusSchema = z.enum(teamTaskStatuses);
export type TeamTaskStatus = z.infer<typeof teamTaskStatusSchema>;

export const teamTaskStatusLabels: Record<TeamTaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

/** Mirrors `team_tasks_priority_valid`. */
export const teamTaskPriorities = ["low", "normal", "high", "urgent"] as const;
export const teamTaskPrioritySchema = z.enum(teamTaskPriorities);
export type TeamTaskPriority = z.infer<typeof teamTaskPrioritySchema>;

export const teamTaskPriorityLabels: Record<TeamTaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export function isTeamTaskStatus(value: unknown): value is TeamTaskStatus {
  return teamTaskStatusSchema.safeParse(value).success;
}

export function isTeamTaskPriority(value: unknown): value is TeamTaskPriority {
  return teamTaskPrioritySchema.safeParse(value).success;
}

/** Mirrors `team_conversations_task_creation_policy_valid`. */
export const teamTaskCreationPolicies = ["owner_only", "admins_and_owner", "everyone"] as const;
export const teamTaskCreationPolicySchema = z.enum(teamTaskCreationPolicies);
export type TeamTaskCreationPolicy = z.infer<typeof teamTaskCreationPolicySchema>;

export const teamTaskCreationPolicyLabels: Record<TeamTaskCreationPolicy, string> = {
  owner_only: "Owner only",
  admins_and_owner: "Admins and Owner",
  everyone: "Everyone",
};

/** Mirrors `team_conversations_slow_mode_scope_valid`. */
export const teamSlowModeScopes = ["members_only", "members_and_admins"] as const;
export const teamSlowModeScopeSchema = z.enum(teamSlowModeScopes);
export type TeamSlowModeScope = z.infer<typeof teamSlowModeScopeSchema>;

export const teamSlowModeScopeLabels: Record<TeamSlowModeScope, string> = {
  members_only: "Members only",
  members_and_admins: "Members + Admins",
};

/** The fixed preset durations the Conversation Controls picker offers, in seconds. */
export const teamSlowModePresetSeconds = [5, 10, 30, 60, 300] as const;
export const teamSlowModeMaxSeconds = 86400;

/** Mirrors the five granular grants on `team_conversation_admins`. */
export const teamConversationCapabilities = [
  "manage_members",
  "manage_admins",
  "manage_slow_mode",
  "rename_conversation",
  "manage_task_policy",
] as const;
export const teamConversationCapabilitySchema = z.enum(teamConversationCapabilities);
export type TeamConversationCapability = z.infer<typeof teamConversationCapabilitySchema>;

export const teamConversationCapabilityLabels: Record<TeamConversationCapability, string> = {
  manage_members: "Manage members",
  manage_admins: "Manage admins",
  manage_slow_mode: "Slow Mode",
  rename_conversation: "Rename",
  manage_task_policy: "Task policy",
};

// -----------------------------------------------------------------------------
// Limits — kept identical to the database CHECK constraints so the composer can
// stop a message the database would have refused, rather than discovering it.
// -----------------------------------------------------------------------------

export const teamMessageMaxLength = 4000;
export const teamGroupTitleMaxLength = 80;
export const teamTaskTitleMaxLength = 200;
export const teamTaskDescriptionMaxLength = 2000;
export const teamSearchQueryMaxLength = 200;
export const teamReplyQuoteMaxLength = 500;
export const teamVoiceMaxDurationMs = 5 * 60 * 1000;
export const teamVoiceMaxBytes = 5 * 1024 * 1024;
export const teamVoiceDefaultRetentionDays = 90;
export const teamVoiceMinRetentionDays = 30;
export const teamVoiceMaxRetentionDays = 365;
export const teamVoicePlaybackUrlSeconds = 5 * 60;

/** Browser-declared values are only upload-slot hints; finalize sniffs the file server-side. */
export const teamVoiceMimeTypes = [
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mp4",
] as const;
export const teamVoiceMimeTypeSchema = z.enum(teamVoiceMimeTypes);
export type TeamVoiceMimeType = z.infer<typeof teamVoiceMimeTypeSchema>;

/** Mirrors `team_message_reactions_code_valid`. Stable codes, never a raw emoji. */
export const teamReactionCodes = [
  "like",
  "heart",
  "laugh",
  "wow",
  "celebrate",
  "fire",
  "eyes",
  "pray",
  "check",
] as const;
export const teamReactionCodeSchema = z.enum(teamReactionCodes);
export type TeamReactionCode = z.infer<typeof teamReactionCodeSchema>;

export function isTeamReactionCode(value: unknown): value is TeamReactionCode {
  return teamReactionCodeSchema.safeParse(value).success;
}

/** Application-owned emoji mapping. The database never sees these glyphs. */
export const teamReactionEmoji: Record<TeamReactionCode, string> = {
  like: "\u{1F44D}",
  heart: "\u{2764}\u{FE0F}",
  laugh: "\u{1F602}",
  wow: "\u{1F62E}",
  celebrate: "\u{1F389}",
  fire: "\u{1F525}",
  eyes: "\u{1F440}",
  pray: "\u{1F64F}",
  check: "\u{2705}",
};

/** The compact picker's full set, in display order. */
export const teamPickerReactionCodes = teamReactionCodes;

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export const startTeamConversationSchema = z.object({
  otherProfileId: uuidSchema,
});
export type StartTeamConversationInput = z.infer<typeof startTeamConversationSchema>;

export const createTeamGroupSchema = z.object({
  title: nonBlankTextSchema.max(teamGroupTitleMaxLength),
  memberProfileIds: z.array(uuidSchema).min(2).max(50),
});
export type CreateTeamGroupInput = z.infer<typeof createTeamGroupSchema>;

/**
 * `requestId` is a browser-generated idempotency key, not an identity claim.
 * A retried send replays the original row instead of producing a second
 * message, which is what makes an optimistic composer safe to retry.
 */
export const sendTeamMessageSchema = z.object({
  requestId: uuidSchema,
  conversationId: uuidSchema,
  body: nonBlankTextSchema.max(teamMessageMaxLength),
});
export type SendTeamMessageInput = z.infer<typeof sendTeamMessageSchema>;

export const sendTeamReplySchema = sendTeamMessageSchema.extend({
  replyToMessageId: uuidSchema,
  replyQuoteText: nonBlankTextSchema.max(teamReplyQuoteMaxLength),
});
export type SendTeamReplyInput = z.infer<typeof sendTeamReplySchema>;

export const forwardTeamMessageSchema = z.object({
  requestId: uuidSchema,
  sourceMessageId: uuidSchema,
  destinationConversationId: uuidSchema,
});
export type ForwardTeamMessageInput = z.infer<typeof forwardTeamMessageSchema>;

export const teamMessageIdSchema = z.object({ messageId: uuidSchema });
export type TeamMessageIdInput = z.infer<typeof teamMessageIdSchema>;

export const teamConversationMessageSchema = z.object({
  conversationId: uuidSchema,
  messageId: uuidSchema,
});
export type TeamConversationMessageInput = z.infer<typeof teamConversationMessageSchema>;

export const teamConversationPinSchema = z.object({
  conversationId: uuidSchema,
  pinId: uuidSchema,
});
export type TeamConversationPinInput = z.infer<typeof teamConversationPinSchema>;

export const prepareTeamVoiceUploadSchema = z.object({
  conversationId: uuidSchema,
  mimeType: teamVoiceMimeTypeSchema,
});
export type PrepareTeamVoiceUploadInput = z.infer<typeof prepareTeamVoiceUploadSchema>;

export const finalizeTeamVoiceUploadSchema = z.object({
  uploadId: uuidSchema,
  /** Used only as a cross-check against server-measured duration. */
  recordedDurationMs: z.number().int().min(1).max(teamVoiceMaxDurationMs),
});
export type FinalizeTeamVoiceUploadInput = z.infer<typeof finalizeTeamVoiceUploadSchema>;

export const teamConversationIdSchema = z.object({
  conversationId: uuidSchema,
});
export type TeamConversationIdInput = z.infer<typeof teamConversationIdSchema>;

/**
 * One opaque browser-tab connection. This is an idempotency/connection key,
 * never an identity claim: every presence RPC derives the profile from
 * auth.uid() and accepts no profile-shaped parameter.
 */
export const teamPresenceConnectionSchema = z.object({
  connectionId: uuidSchema,
});
export type TeamPresenceConnectionInput = z.infer<
  typeof teamPresenceConnectionSchema
>;

export const teamTypingConnectionSchema = z.object({
  conversationId: uuidSchema,
  connectionId: uuidSchema,
});
export type TeamTypingConnectionInput = z.infer<
  typeof teamTypingConnectionSchema
>;

export const teamTypingRequestSchema = teamTypingConnectionSchema.extend({
  operation: z.enum(["touch", "clear"]),
});

/**
 * The latency-sensitive read. `since` is the caller's own previous
 * `serverTime`, which is what keeps the delta empty on a quiet tick.
 */
export const teamLiveRequestSchema = z.object({
  conversationId: uuidSchema.nullable(),
  since: z.iso.datetime({ offset: true }).nullable(),
});

export type TeamLiveRequest = z.infer<typeof teamLiveRequestSchema>;

/**
 * The background read. It carries no conversation id: the open thread is the
 * live lane's business, and this one must never be on that path.
 */
export const teamSyncRequestSchema = z.object({
  includeConversations: z.boolean(),
  includeTasks: z.boolean(),
  includeTeamTasks: z.boolean(),
  includeMembers: z.boolean(),
  materializeDigests: z.boolean(),
});

export const createTeamTaskSchema = z.object({
  requestId: uuidSchema,
  conversationId: uuidSchema,
  title: nonBlankTextSchema.max(teamTaskTitleMaxLength),
  assignedToProfileId: uuidSchema,
  description: nonBlankTextSchema.max(teamTaskDescriptionMaxLength).nullable().optional(),
  priority: teamTaskPrioritySchema.default("normal"),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  /** Set when the task was made from a specific message rather than the composer. */
  sourceMessageId: uuidSchema.nullable().optional(),
});
export type CreateTeamTaskInput = z.infer<typeof createTeamTaskSchema>;

export const updateTeamTaskStatusSchema = z.object({
  taskId: uuidSchema,
  status: teamTaskStatusSchema,
});
export type UpdateTeamTaskStatusInput = z.infer<typeof updateTeamTaskStatusSchema>;

/**
 * A sparse patch: only the keys present are changed. `null` is a real value
 * for `dueAt` and `description` (clear it), which is why the schema keeps
 * nullable-optional rather than collapsing the two.
 */
export const updateTeamTaskDetailsSchema = z
  .object({
    taskId: uuidSchema,
    title: nonBlankTextSchema.max(teamTaskTitleMaxLength).optional(),
    description: z
      .string()
      .trim()
      .max(teamTaskDescriptionMaxLength)
      .nullable()
      .optional(),
    priority: teamTaskPrioritySchema.optional(),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    assignedToProfileId: uuidSchema.optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.priority !== undefined ||
      value.dueAt !== undefined ||
      value.assignedToProfileId !== undefined,
    { message: "Nothing to change." },
  );
export type UpdateTeamTaskDetailsInput = z.infer<typeof updateTeamTaskDetailsSchema>;

export const renameTeamConversationSchema = z.object({
  conversationId: uuidSchema,
  title: nonBlankTextSchema.max(teamGroupTitleMaxLength),
});
export type RenameTeamConversationInput = z.infer<typeof renameTeamConversationSchema>;

/** `seconds: null` turns Slow Mode off. */
export const setTeamConversationSlowModeSchema = z.object({
  conversationId: uuidSchema,
  seconds: z.number().int().min(1).max(teamSlowModeMaxSeconds).nullable(),
  scope: teamSlowModeScopeSchema.default("members_and_admins"),
});
export type SetTeamConversationSlowModeInput = z.infer<typeof setTeamConversationSlowModeSchema>;

export const setTeamTaskCreationPolicySchema = z.object({
  conversationId: uuidSchema,
  policy: teamTaskCreationPolicySchema,
});
export type SetTeamTaskCreationPolicyInput = z.infer<typeof setTeamTaskCreationPolicySchema>;

/** At least one capability must be requested — enforced by the RPC as well. */
export const grantTeamConversationAdminSchema = z.object({
  conversationId: uuidSchema,
  targetProfileId: uuidSchema,
  capabilities: z
    .object({
      manage_members: z.boolean().optional(),
      manage_admins: z.boolean().optional(),
      manage_slow_mode: z.boolean().optional(),
      rename_conversation: z.boolean().optional(),
      manage_task_policy: z.boolean().optional(),
    })
    .refine((value) => Object.values(value).some(Boolean), {
      message: "Grant at least one capability.",
    }),
});
export type GrantTeamConversationAdminInput = z.infer<typeof grantTeamConversationAdminSchema>;

export const revokeTeamConversationAdminSchema = z.object({
  conversationId: uuidSchema,
  targetProfileId: uuidSchema,
});
export type RevokeTeamConversationAdminInput = z.infer<typeof revokeTeamConversationAdminSchema>;

export const addTeamConversationMemberSchema = z.object({
  conversationId: uuidSchema,
  profileId: uuidSchema,
});
export type AddTeamConversationMemberInput = z.infer<typeof addTeamConversationMemberSchema>;

export const removeTeamConversationMemberSchema = z.object({
  conversationId: uuidSchema,
  profileId: uuidSchema,
});
export type RemoveTeamConversationMemberInput = z.infer<typeof removeTeamConversationMemberSchema>;

export const toggleTeamMessageReactionSchema = z.object({
  messageId: uuidSchema,
  reactionCode: teamReactionCodeSchema,
});
export type ToggleTeamMessageReactionInput = z.infer<typeof toggleTeamMessageReactionSchema>;

/** A stable (created_at, id) cursor — never OFFSET. */
export const teamMessagesBeforeSchema = z.object({
  conversationId: uuidSchema,
  beforeCreatedAt: z.iso.datetime({ offset: true }),
  beforeId: uuidSchema,
  limit: z.number().int().min(1).max(100).optional(),
});
export type TeamMessagesBeforeInput = z.infer<typeof teamMessagesBeforeSchema>;

/** The minimum architecture a search result click needs: a bounded window around one target. */
export const teamMessageWindowSchema = z.object({
  conversationId: uuidSchema,
  messageId: uuidSchema,
  before: z.number().int().min(0).max(100).optional(),
  after: z.number().int().min(0).max(100).optional(),
});
export type TeamMessageWindowInput = z.infer<typeof teamMessageWindowSchema>;

export const searchTeamConversationMessagesSchema = z.object({
  conversationId: uuidSchema,
  query: nonBlankTextSchema.max(teamSearchQueryMaxLength),
  beforeCreatedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  beforeId: uuidSchema.nullable().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type SearchTeamConversationMessagesInput = z.infer<
  typeof searchTeamConversationMessagesSchema
>;

// -----------------------------------------------------------------------------
// Read-model rows, as the RPCs return them.
//
// PostgreSQL cannot express per-column nullability for `returns table`, so the
// generated types report every column non-null. These declarations restate the
// truth the migration actually allows, which is what the projections are
// written against.
// -----------------------------------------------------------------------------

export type TeamMemberRow = {
  profile_id: string;
  display_name: string | null;
  email?: string | null;
  avatar_url: string | null;
};

export type TeamConversationRow = {
  conversation_id: string;
  conversation_kind?: "direct" | "group";
  conversation_title?: string | null;
  /** Reserved read-model seam for a future persisted group image migration. */
  conversation_image_url?: string | null;
  member_count?: number;
  other_member_profile_id: string | null;
  other_member_name: string | null;
  other_member_avatar_url: string | null;
  last_message_id?: string | null;
  last_message_type?: "text" | "voice" | "task_activity" | "governance_activity" | null;
  last_message_author_profile_id?: string | null;
  last_message_author_name?: string | null;
  last_message_author_avatar_url?: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
  my_last_read_at: string | null;
  destination_search_text?: string | null;
};

/** One reaction code aggregated across every reactor still active on a message. */
export type TeamMessageReactionRow = {
  reaction_code: string;
  reaction_count: number;
  reacted_by_me: boolean;
  reactor_names: (string | null)[];
};

export type TeamMessageRow = {
  id: string;
  request_id?: string;
  conversation_id: string;
  author_profile_id: string;
  author_name: string | null;
  author_avatar_url: string | null;
  body: string;
  message_type?: "text" | "voice" | "task_activity" | "governance_activity";
  task_id?: string | null;
  task_action?: "completed" | "reopened" | "created" | null;
  created_at: string;
  reactions?: TeamMessageReactionRow[];
  reply_to_message_id?: string | null;
  reply_quote_text?: string | null;
  reply_source_author_name?: string | null;
  reply_source_deleted?: boolean;
  forwarded_from_message_id?: string | null;
  forwarded_from_ticket_message_id?: string | null;
  forwarded_from_author_name?: string | null;
  deleted_for_everyone?: boolean;
  voice_storage_path?: string | null;
  voice_duration_ms?: number | null;
  voice_size_bytes?: number | null;
  voice_mime_type?: string | null;
  voice_expires_at?: string | null;
  voice_expired_at?: string | null;
};

export type TeamMessagePinRow = {
  id: string;
  conversation_id: string;
  message_id: string;
  author_profile_id: string;
  author_name: string | null;
  text_preview: string | null;
  message_created_at: string;
  message_deleted: boolean;
  pinned_by_profile_id: string;
  pinned_by_name: string | null;
  pinned_at: string;
  unpinned_by_profile_id: string | null;
  unpinned_by_name: string | null;
  unpinned_at: string | null;
};

export type TeamTaskRow = {
  id: string;
  conversation_id: string;
  source_message_id: string | null;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  completed_at: string | null;
  completed_by_profile_id?: string | null;
  created_at: string;
  updated_at: string;
  assigned_to_profile_id: string;
  assigned_to_name: string | null;
  created_by_profile_id: string;
  created_by_name: string | null;
};

/** `app_list_my_team_tasks` adds cross-conversation context columns. */
export type TeamTaskListRow = TeamTaskRow & {
  conversation_kind?: "direct" | "group";
  conversation_name?: string | null;
  other_member_name: string | null;
  is_mine: boolean;
};

export type TeamTypingRow = {
  profile_id: string;
  display_name: string | null;
  avatar_url: string | null;
  last_typed_at: string;
};

/** One delegated admin grant, as `app_get_team_conversation` returns it. */
export type TeamConversationAdminRow = TeamMemberRow & {
  can_manage_members: boolean;
  can_manage_admins: boolean;
  can_manage_slow_mode: boolean;
  can_rename_conversation: boolean;
  can_manage_task_policy: boolean;
};

/** What the acting profile is authorized to do in this conversation. */
export type TeamConversationCapabilitiesRow = {
  is_owner: boolean;
  can_create_task: boolean;
  can_manage_members: boolean;
  can_manage_admins: boolean;
  can_manage_slow_mode: boolean;
  can_rename_conversation: boolean;
  can_manage_task_policy: boolean;
  can_send_voice?: boolean;
  can_manage_pins?: boolean;
};

/** The `app_get_team_conversation` JSON envelope. */
export type TeamConversationDetailRow = {
  conversation_id: string;
  conversation_kind?: "direct" | "group";
  conversation_title?: string | null;
  /** Absent until the owner-authorized group image persistence migration exists. */
  conversation_image_url?: string | null;
  owner_profile_id?: string;
  slow_mode_seconds?: number | null;
  slow_mode_scope?: TeamSlowModeScope;
  task_creation_policy?: TeamTaskCreationPolicy;
  /** Present and in the future only while a cooldown is actually active for me. */
  my_next_allowed_send_at?: string | null;
  my_capabilities?: TeamConversationCapabilitiesRow;
  admins?: TeamConversationAdminRow[];
  members?: TeamMemberRow[];
  other_member: {
    profile_id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  messages: TeamMessageRow[];
  tasks: TeamTaskRow[];
  typing?: TeamTypingRow[];
  pins?: TeamMessagePinRow[];
};

/**
 * One conversation that moved.
 *
 * Structurally the same row `app_list_team_conversations` returns, so the peek
 * and the list cannot disagree about a colleague's name or a preview: the delta
 * is a filtered projection of that list, not a second description of it.
 */
export type TeamConversationSignalRow = TeamConversationRow;

/** The `app_team_live_sync` JSON envelope. */
export type TeamLiveSyncRow = {
  server_time: string;
  detail: TeamConversationDetailRow | null;
  unread_total: number;
  signals: TeamConversationSignalRow[];
};

/** The JSON a write RPC echoes back. */
export type TeamMessageWriteRow = {
  id: string;
  request_id: string;
  conversation_id: string;
  author_profile_id: string;
  body: string;
  created_at: string;
  message_type?: "text" | "voice";
  voice_duration_ms?: number | null;
  voice_size_bytes?: number | null;
  voice_mime_type?: string | null;
  voice_expires_at?: string | null;
};

export type TeamVoiceUploadClaimRow = {
  upload_id: string;
  conversation_id: string;
  storage_path: string;
  declared_mime_type: TeamVoiceMimeType;
  expires_at: string;
};

export type TeamVoiceUploadContextRow = TeamVoiceUploadClaimRow & {
  status: "pending" | "finalized" | "abandoned";
  message_id: string | null;
};

export type TeamVoicePlaybackRow = {
  message_id: string;
  conversation_id: string;
  storage_path: string | null;
  mime_type: string | null;
  duration_ms: number | null;
  expired_at: string | null;
};

export type TeamVoiceCleanupObjectRow = {
  object_kind: "message" | "upload";
  record_id: string;
  storage_path: string;
};

/** `app_toggle_team_message_reaction`'s envelope. */
export type TeamReactionToggleRow = {
  message_id: string;
  reacted_by_me: boolean;
  reactions: TeamMessageReactionRow[];
};

/** `app_list_team_messages_before` — "Load older", keyset on (created_at, id). */
export type TeamMessagesBeforeRow = {
  messages: TeamMessageRow[];
  has_more: boolean;
};

/** `app_get_team_message_window` — a bounded page around one target message. */
export type TeamMessageWindowRow = {
  found: boolean;
  messages: TeamMessageRow[];
};

/** One `app_search_team_conversation_messages` hit. `snippet` carries private-use
 * sentinel characters around each match — never HTML — for
 * `parseTeamHighlightedSnippet` to split into render-safe segments. */
export type TeamSearchResultRow = {
  id: string;
  author_profile_id: string;
  author_name: string | null;
  author_avatar_url: string | null;
  created_at: string;
  snippet: string;
};

export type TeamSearchResponseRow = {
  results: TeamSearchResultRow[];
  has_more: boolean;
};

// -----------------------------------------------------------------------------
// Governance mutation envelopes
// -----------------------------------------------------------------------------

export type TeamConversationTitleRow = { conversation_id: string; title: string };

export type TeamConversationSlowModeRow = {
  conversation_id: string;
  slow_mode_seconds: number | null;
  slow_mode_scope: TeamSlowModeScope;
};

export type TeamConversationTaskPolicyRow = {
  conversation_id: string;
  task_creation_policy: TeamTaskCreationPolicy;
};

export type TeamConversationAdminGrantRow = {
  conversation_id: string;
  profile_id: string;
  can_manage_members: boolean;
  can_manage_admins: boolean;
  can_manage_slow_mode: boolean;
  can_rename_conversation: boolean;
  can_manage_task_policy: boolean;
};

export type TeamConversationMemberChangeRow = { conversation_id: string; profile_id: string };
