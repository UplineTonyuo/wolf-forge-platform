import type {
  AddTeamConversationMemberInput,
  CreateTeamTaskInput,
  CreateTeamGroupInput,
  ForwardTeamMessageInput,
  GrantTeamConversationAdminInput,
  RemoveTeamConversationMemberInput,
  RenameTeamConversationInput,
  RevokeTeamConversationAdminInput,
  SearchTeamConversationMessagesInput,
  SendTeamMessageInput,
  SendTeamReplyInput,
  SetTeamConversationSlowModeInput,
  SetTeamTaskCreationPolicyInput,
  StartTeamConversationInput,
  TeamConversationAdminGrantRow,
  TeamConversationDetailRow,
  TeamConversationIdInput,
  TeamConversationMemberChangeRow,
  TeamConversationRow,
  TeamConversationSlowModeRow,
  TeamConversationTaskPolicyRow,
  TeamConversationTitleRow,
  TeamLiveRequest,
  TeamLiveSyncRow,
  TeamMemberRow,
  TeamMessagesBeforeInput,
  TeamMessagesBeforeRow,
  TeamMessageWindowInput,
  TeamMessageWindowRow,
  TeamMessageWriteRow,
  TeamMessageIdInput,
  TeamPresenceConnectionInput,
  TeamReactionToggleRow,
  TeamSearchResponseRow,
  TeamTypingConnectionInput,
  TeamTaskListRow,
  TeamTaskRow,
  ToggleTeamMessageReactionInput,
  UpdateTeamTaskDetailsInput,
  UpdateTeamTaskStatusInput,
} from "../domain/team/schema";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type { Json } from "../lib/supabase/database.types";
import type { UserMutationClient } from "./types";

/**
 * Internal team communication access.
 *
 * RPCs only, no table access — and not by convention: the migration revokes
 * every privilege on team_conversations, team_conversation_members,
 * team_messages and team_tasks from anon, authenticated and service_role, so
 * there is no table surface here to reach even if someone tried.
 *
 * Not one call passes an actor. Author, creator and reader are all derived from
 * auth.uid() inside the SECURITY DEFINER function, which is what makes sender
 * spoofing structurally impossible rather than merely checked.
 */
export class TeamRepository {
  constructor(private readonly client: UserMutationClient) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** Active internal colleagues the actor can open a conversation with. */
  async listMembers(): Promise<TeamMemberRow[]> {
    const result = await this.client.rpc("app_list_team_members");
    if (result.error) throw mapDatabaseError(result.error, "Team messages");
    return (result.data ?? []) as unknown as TeamMemberRow[];
  }

  async listConversations(): Promise<TeamConversationRow[]> {
    const result = await this.client.rpc("app_list_team_conversations");
    if (result.error) throw mapDatabaseError(result.error, "Team messages");
    return (result.data ?? []) as unknown as TeamConversationRow[];
  }

  /**
   * The whole latency-sensitive read in one call: the open thread with its
   * typing state, the conversations that moved since the caller's own last
   * answer, and the unread total. Deliberately excludes the roster, the task
   * lists and the digest materializer — those ride the background cadence.
   */
  async liveSync(input: TeamLiveRequest): Promise<TeamLiveSyncRow> {
    const result = await this.client.rpc("app_team_live_sync", {
      p_conversation_id: input.conversationId ?? undefined,
      p_since: input.since ?? undefined,
    });

    if (result.error) throw mapDatabaseError(result.error, "Team messages");
    return result.data as unknown as TeamLiveSyncRow;
  }

  /** Cheap badge fuel: one integer, no message bodies. */
  async unreadCount(): Promise<number> {
    const result = await this.client.rpc("app_team_unread_count");
    if (result.error) throw mapDatabaseError(result.error, "Team messages");
    return result.data ?? 0;
  }

  /** Materializes stale offline unread groups for this server-derived actor. */
  async materializeMessageDigests(): Promise<number> {
    const result = await this.client.rpc("app_materialize_team_message_digests");
    if (result.error) throw mapDatabaseError(result.error, "Team message digest");
    return result.data ?? 0;
  }

  async getConversation(input: TeamConversationIdInput): Promise<TeamConversationDetailRow> {
    const result = await this.client.rpc("app_get_team_conversation", {
      p_conversation_id: input.conversationId,
    });

    if (result.error) throw mapDatabaseError(result.error, "Conversation");
    return result.data as unknown as TeamConversationDetailRow;
  }

  /**
   * Tasks assigned to the actor, and — when `includeTeam` is set and the caller
   * actually holds team_tasks.manage — every task in the conversations they are
   * party to. The flag is a request, not a grant: the database re-checks the
   * capability and silently narrows the result if it is absent.
   */
  async listMyTasks(includeTeam = false): Promise<TeamTaskListRow[]> {
    const result = await this.client.rpc("app_list_my_team_tasks", {
      p_include_team: includeTeam,
    });

    if (result.error) throw mapDatabaseError(result.error, "Team tasks");
    return (result.data ?? []) as unknown as TeamTaskListRow[];
  }

  /**
   * "Load older": one keyset page strictly before the caller's own oldest
   * loaded message. `(created_at, id)` is a stable cursor; OFFSET is never
   * used, so the answer stays correct even while new messages keep arriving.
   */
  async listMessagesBefore(input: TeamMessagesBeforeInput): Promise<TeamMessagesBeforeRow> {
    const result = await this.client.rpc("app_list_team_messages_before", {
      p_conversation_id: input.conversationId,
      p_before_created_at: input.beforeCreatedAt,
      p_before_id: input.beforeId,
      p_limit: input.limit ?? undefined,
    });

    if (result.error) throw mapDatabaseError(result.error, "Team messages");
    return result.data as unknown as TeamMessagesBeforeRow;
  }

  /**
   * A bounded window of messages around one target — the minimum architecture
   * a search result click needs when the target sits outside the currently
   * loaded range.
   */
  async getMessageWindow(input: TeamMessageWindowInput): Promise<TeamMessageWindowRow> {
    const result = await this.client.rpc("app_get_team_message_window", {
      p_conversation_id: input.conversationId,
      p_message_id: input.messageId,
      p_before: input.before ?? undefined,
      p_after: input.after ?? undefined,
    });

    if (result.error) throw mapDatabaseError(result.error, "Team messages");
    return result.data as unknown as TeamMessageWindowRow;
  }

  /**
   * Conversation-scoped, server-side search. The server derives authorization
   * from the caller's own membership in `conversationId`; there is no
   * parameter that could reach a conversation the actor does not belong to.
   */
  async searchMessages(
    input: SearchTeamConversationMessagesInput,
  ): Promise<TeamSearchResponseRow> {
    const result = await this.client.rpc("app_search_team_conversation_messages", {
      p_conversation_id: input.conversationId,
      p_query: input.query,
      p_before_created_at: input.beforeCreatedAt ?? undefined,
      p_before_id: input.beforeId ?? undefined,
      p_limit: input.limit ?? undefined,
    });

    if (result.error) throw mapDatabaseError(result.error, "Team search");
    return result.data as unknown as TeamSearchResponseRow;
  }

  /**
   * Refresh one tab/device connection and receive only active profile ids.
   * The database derives which profile owns the connection from auth.uid().
   */
  async touchPresence(input: TeamPresenceConnectionInput): Promise<string[]> {
    const result = await this.client.rpc("app_touch_team_presence", {
      p_connection_id: input.connectionId,
    });

    if (result.error) throw mapDatabaseError(result.error, "Team presence");
    return (result.data ?? []) as unknown as string[];
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /** Get-or-create; the deterministic pair key makes a racing second tab safe. */
  async startConversation(input: StartTeamConversationInput): Promise<string> {
    const result = await this.client.rpc("app_start_team_conversation", {
      p_other_profile_id: input.otherProfileId,
    });

    if (result.error) throw mapDatabaseError(result.error, "Conversation");
    return result.data as unknown as string;
  }

  async createGroup(input: CreateTeamGroupInput): Promise<string> {
    const result = await this.client.rpc("app_create_team_group", {
      p_title: input.title,
      p_member_profile_ids: input.memberProfileIds,
    });
    if (result.error) throw mapDatabaseError(result.error, "Group conversation");
    return result.data as unknown as string;
  }

  /** Idempotent on `requestId`: a retry replays the original row. */
  async sendMessage(input: SendTeamMessageInput): Promise<TeamMessageWriteRow> {
    const result = await this.client.rpc("app_send_team_message", {
      p_request_id: input.requestId,
      p_conversation_id: input.conversationId,
      p_body: input.body,
    });

    if (result.error) throw mapDatabaseError(result.error, "Message");
    return result.data as unknown as TeamMessageWriteRow;
  }

  async sendReply(input: SendTeamReplyInput): Promise<TeamMessageWriteRow> {
    const result = await this.client.rpc("app_send_team_reply", {
      p_request_id: input.requestId,
      p_conversation_id: input.conversationId,
      p_body: input.body,
      p_reply_to_message_id: input.replyToMessageId,
      p_reply_quote_text: input.replyQuoteText,
    });
    if (result.error) throw mapDatabaseError(result.error, "Reply");
    return result.data as unknown as TeamMessageWriteRow;
  }

  async forwardMessage(input: ForwardTeamMessageInput): Promise<TeamMessageWriteRow> {
    const result = await this.client.rpc("app_forward_team_message", {
      p_request_id: input.requestId,
      p_source_message_id: input.sourceMessageId,
      p_destination_conversation_id: input.destinationConversationId,
    });
    if (result.error) throw mapDatabaseError(result.error, "Forward");
    return result.data as unknown as TeamMessageWriteRow;
  }

  async hideMessageForMe(input: TeamMessageIdInput): Promise<void> {
    const result = await this.client.rpc("app_hide_team_message_for_me", {
      p_message_id: input.messageId,
    });
    if (result.error) throw mapDatabaseError(result.error, "Delete message");
  }

  async deleteMessageForEveryone(input: TeamMessageIdInput): Promise<void> {
    const result = await this.client.rpc("app_delete_team_message_for_everyone", {
      p_message_id: input.messageId,
    });
    if (result.error) throw mapDatabaseError(result.error, "Delete message");
  }

  /**
   * Idempotent toggle. The reactor is always auth.uid(); the database
   * re-derives conversation membership from the message being reacted to, so
   * a message from one conversation can never be reacted to by a member of
   * another.
   */
  async toggleReaction(input: ToggleTeamMessageReactionInput): Promise<TeamReactionToggleRow> {
    const result = await this.client.rpc("app_toggle_team_message_reaction", {
      p_message_id: input.messageId,
      p_reaction_code: input.reactionCode,
    });

    if (result.error) throw mapDatabaseError(result.error, "Reaction");
    return result.data as unknown as TeamReactionToggleRow;
  }

  async markRead(input: TeamConversationIdInput): Promise<void> {
    const result = await this.client.rpc("app_mark_team_conversation_read", {
      p_conversation_id: input.conversationId,
    });

    if (result.error) throw mapDatabaseError(result.error, "Conversation");
  }

  async disconnectPresence(input: TeamPresenceConnectionInput): Promise<void> {
    const result = await this.client.rpc("app_disconnect_team_presence", {
      p_connection_id: input.connectionId,
    });

    if (result.error) throw mapDatabaseError(result.error, "Team presence");
  }

  async touchTyping(input: TeamTypingConnectionInput): Promise<void> {
    const result = await this.client.rpc("app_touch_team_typing", {
      p_conversation_id: input.conversationId,
      p_connection_id: input.connectionId,
    });
    if (result.error) throw mapDatabaseError(result.error, "Typing state");
  }

  async clearTyping(input: TeamTypingConnectionInput): Promise<void> {
    const result = await this.client.rpc("app_clear_team_typing", {
      p_conversation_id: input.conversationId,
      p_connection_id: input.connectionId,
    });
    if (result.error) throw mapDatabaseError(result.error, "Typing state");
  }

  async createTask(input: CreateTeamTaskInput): Promise<TeamTaskRow> {
    const result = await this.client.rpc("app_create_team_task", {
      p_request_id: input.requestId,
      p_conversation_id: input.conversationId,
      p_title: input.title,
      p_assigned_to_profile_id: input.assignedToProfileId,
      p_description: input.description ?? undefined,
      p_priority: input.priority,
      p_due_at: input.dueAt ?? undefined,
      p_source_message_id: input.sourceMessageId ?? undefined,
    });

    if (result.error) throw mapDatabaseError(result.error, "Team task");
    return result.data as unknown as TeamTaskRow;
  }

  async updateTaskStatus(input: UpdateTeamTaskStatusInput): Promise<TeamTaskRow> {
    const result = await this.client.rpc("app_update_team_task_status", {
      p_task_id: input.taskId,
      p_status: input.status,
    });

    if (result.error) throw mapDatabaseError(result.error, "Team task");
    return result.data as unknown as TeamTaskRow;
  }

  /**
   * Sparse patch. Only the keys the caller actually supplied are forwarded, so
   * an untouched field keeps its stored value rather than being rewritten with
   * a stale copy the browser happened to be holding.
   */
  async updateTaskDetails(input: UpdateTeamTaskDetailsInput): Promise<TeamTaskRow> {
    const patch: Record<string, Json> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.dueAt !== undefined) patch.due_at = input.dueAt;
    if (input.assignedToProfileId !== undefined) {
      patch.assigned_to_profile_id = input.assignedToProfileId;
    }

    const result = await this.client.rpc("app_update_team_task_details", {
      p_task_id: input.taskId,
      p_patch: patch,
    });

    if (result.error) throw mapDatabaseError(result.error, "Team task");
    return result.data as unknown as TeamTaskRow;
  }

  // ---------------------------------------------------------------------------
  // Governance (V2.6): owner is always team_conversations.created_by_profile_id
  // and never appears here. Delegated authority, Slow Mode and task policy are
  // all re-checked server-side; nothing below grants anything on its own.
  // ---------------------------------------------------------------------------

  async renameConversation(input: RenameTeamConversationInput): Promise<TeamConversationTitleRow> {
    const result = await this.client.rpc("app_rename_team_conversation", {
      p_conversation_id: input.conversationId,
      p_title: input.title,
    });
    if (result.error) throw mapDatabaseError(result.error, "Conversation");
    return result.data as unknown as TeamConversationTitleRow;
  }

  async setSlowMode(
    input: SetTeamConversationSlowModeInput,
  ): Promise<TeamConversationSlowModeRow> {
    const result = await this.client.rpc("app_set_team_conversation_slow_mode", {
      p_conversation_id: input.conversationId,
      // The generated type marks this required because the SQL parameter has
      // no DEFAULT, but it is a genuinely nullable integer — null is exactly
      // how the RPC is told to turn Slow Mode off.
      p_seconds: input.seconds as number,
      p_scope: input.scope,
    });
    if (result.error) throw mapDatabaseError(result.error, "Slow Mode");
    return result.data as unknown as TeamConversationSlowModeRow;
  }

  async setTaskCreationPolicy(
    input: SetTeamTaskCreationPolicyInput,
  ): Promise<TeamConversationTaskPolicyRow> {
    const result = await this.client.rpc("app_set_team_task_creation_policy", {
      p_conversation_id: input.conversationId,
      p_policy: input.policy,
    });
    if (result.error) throw mapDatabaseError(result.error, "Task policy");
    return result.data as unknown as TeamConversationTaskPolicyRow;
  }

  async grantAdmin(input: GrantTeamConversationAdminInput): Promise<TeamConversationAdminGrantRow> {
    const result = await this.client.rpc("app_grant_team_conversation_admin", {
      p_conversation_id: input.conversationId,
      p_target_profile_id: input.targetProfileId,
      p_capabilities: input.capabilities,
    });
    if (result.error) throw mapDatabaseError(result.error, "Admin grant");
    return result.data as unknown as TeamConversationAdminGrantRow;
  }

  async revokeAdmin(
    input: RevokeTeamConversationAdminInput,
  ): Promise<TeamConversationMemberChangeRow> {
    const result = await this.client.rpc("app_revoke_team_conversation_admin", {
      p_conversation_id: input.conversationId,
      p_target_profile_id: input.targetProfileId,
    });
    if (result.error) throw mapDatabaseError(result.error, "Admin grant");
    return result.data as unknown as TeamConversationMemberChangeRow;
  }

  async addMember(
    input: AddTeamConversationMemberInput,
  ): Promise<TeamConversationMemberChangeRow> {
    const result = await this.client.rpc("app_add_team_conversation_member", {
      p_conversation_id: input.conversationId,
      p_profile_id: input.profileId,
    });
    if (result.error) throw mapDatabaseError(result.error, "Group member");
    return result.data as unknown as TeamConversationMemberChangeRow;
  }

  async removeMember(
    input: RemoveTeamConversationMemberInput,
  ): Promise<TeamConversationMemberChangeRow> {
    const result = await this.client.rpc("app_remove_team_conversation_member", {
      p_conversation_id: input.conversationId,
      p_profile_id: input.profileId,
    });
    if (result.error) throw mapDatabaseError(result.error, "Group member");
    return result.data as unknown as TeamConversationMemberChangeRow;
  }
}
