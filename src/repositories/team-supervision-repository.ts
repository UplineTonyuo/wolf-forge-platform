import "server-only";

import type {
  GetSupervisedConversationInput,
  GetSupervisedMessageWindowInput,
  ListSupervisedConversationsInput,
  ListSupervisedMessagesBeforeInput,
  SearchSupervisedConversationInput,
  SupervisedConversationListRow,
  SupervisedMessageWindowRow,
  SupervisedSearchResponseRow,
  SupervisedTranscriptPageRow,
} from "../domain/team-supervision/schema";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type { UserMutationClient } from "./types";

const resource = "Team conversation";

/**
 * Read-only Team supervision access. One method, one RPC.
 *
 * Takes only the user-scoped client: every supervisory RPC derives the
 * supervisor from `auth.uid()` through `private.require_team_supervisor()`, so
 * a trusted/service-role client would not bypass anything — it would simply be
 * refused (no `service_role` execute grant). No call passes an actor, role or
 * profile id, and there is no table access: Team tables have forced RLS and no
 * application-role grants.
 *
 * Deliberately absent: voice playback, global or multi-conversation search,
 * group supervision, and every participant-state operation (mark-read,
 * delivery, presence, typing, send).
 *
 * Errors pass through `mapDatabaseError` unchanged. A group, mixed, malformed
 * or nonexistent conversation is the database's single safe `P0002`, which
 * stays one indistinguishable NotFoundError here.
 */
export class TeamSupervisionRepository {
  constructor(private readonly client: UserMutationClient) {}

  async listConversations(
    input: ListSupervisedConversationsInput,
  ): Promise<SupervisedConversationListRow[]> {
    const result = await this.client.rpc("app_list_team_supervised_conversations", {
      p_limit: input.limit ?? undefined,
      p_before_last_message_at: input.beforeLastMessageAt ?? undefined,
      p_before_conversation_id: input.beforeConversationId ?? undefined,
    });
    if (result.error) throw mapDatabaseError(result.error, resource);
    return (result.data ?? []) as unknown as SupervisedConversationListRow[];
  }

  /** Emits one `team.supervision.open` audit inside the database. */
  async getConversation(
    input: GetSupervisedConversationInput,
  ): Promise<SupervisedTranscriptPageRow> {
    const result = await this.client.rpc("app_get_team_supervised_conversation", {
      p_conversation_id: input.conversationId,
      p_limit: input.limit ?? undefined,
      p_correlation_id: input.correlationId ?? undefined,
    });
    if (result.error) throw mapDatabaseError(result.error, resource);
    return result.data as unknown as SupervisedTranscriptPageRow;
  }

  /** Emits one `team.supervision.page` audit inside the database. */
  async listMessagesBefore(
    input: ListSupervisedMessagesBeforeInput,
  ): Promise<SupervisedTranscriptPageRow> {
    const result = await this.client.rpc("app_list_team_supervised_messages_before", {
      p_conversation_id: input.conversationId,
      p_before_created_at: input.beforeCreatedAt,
      p_before_message_id: input.beforeMessageId,
      p_limit: input.limit ?? undefined,
      p_correlation_id: input.correlationId ?? undefined,
    });
    if (result.error) throw mapDatabaseError(result.error, resource);
    return result.data as unknown as SupervisedTranscriptPageRow;
  }

  /** Emits one `team.supervision.page` audit when the target is found. */
  async getMessageWindow(
    input: GetSupervisedMessageWindowInput,
  ): Promise<SupervisedMessageWindowRow> {
    const result = await this.client.rpc("app_get_team_supervised_message_window", {
      p_conversation_id: input.conversationId,
      p_target_message_id: input.targetMessageId,
      p_before_limit: input.beforeLimit ?? undefined,
      p_after_limit: input.afterLimit ?? undefined,
      p_correlation_id: input.correlationId ?? undefined,
    });
    if (result.error) throw mapDatabaseError(result.error, resource);
    return result.data as unknown as SupervisedMessageWindowRow;
  }

  /**
   * One explicit conversation per call. Consumes the supervisor's own rate
   * bucket and emits one `team.supervision.search` audit inside the database.
   * The query is sent to the RPC and nowhere else.
   */
  async searchConversation(
    input: SearchSupervisedConversationInput,
  ): Promise<SupervisedSearchResponseRow> {
    const result = await this.client.rpc("app_search_team_supervised_conversation_messages", {
      p_conversation_id: input.conversationId,
      p_query: input.query,
      p_before_created_at: input.beforeCreatedAt ?? undefined,
      p_before_message_id: input.beforeMessageId ?? undefined,
      p_limit: input.limit ?? undefined,
      p_correlation_id: input.correlationId ?? undefined,
    });
    if (result.error) throw mapDatabaseError(result.error, resource);
    return result.data as unknown as SupervisedSearchResponseRow;
  }
}
