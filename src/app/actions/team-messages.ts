"use server";

import { toClientSafeError } from "../../lib/errors/application-error";
import { getInternalContext } from "../../lib/supabase/next-server";
import type {
  TeamConversationAdminGrantRow,
  TeamConversationDetailRow,
  TeamConversationMemberChangeRow,
  TeamConversationRow,
  TeamConversationSlowModeRow,
  TeamConversationTaskPolicyRow,
  TeamConversationTitleRow,
  TeamMemberRow,
  TeamMessagesBeforeRow,
  TeamMessageWindowRow,
  TeamMessageWriteRow,
  TeamReactionToggleRow,
  TeamSearchResponseRow,
  TeamTaskListRow,
  TeamTaskRow,
} from "../../domain/team/schema";

/**
 * Team Messages server actions.
 *
 * Internal only. Every one of these resolves `getInternalContext()`, which
 * redirects a non-staff session to /login before any RPC is reached, and the
 * RPCs themselves then re-derive the acting profile from auth.uid() and
 * re-check team_messages.use. A client account therefore fails twice, and this
 * file contains no parameter that names an author, a sender or a creator.
 *
 * These return database ROWS rather than view models on purpose. The row shapes
 * are plain JSON and survive the server/client boundary intact; the projections
 * in `domain/team/projections.ts` build Maps and Date-derived labels, which do
 * not. The drawer applies them in the browser, where the viewer's own locale
 * and clock are the correct ones to format with.
 */

export type TeamActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type TeamSyncResult = {
  conversations: TeamConversationRow[] | null;
  detail: TeamConversationDetailRow | null;
  tasks: TeamTaskListRow[] | null;
  members: TeamMemberRow[] | null;
};

function failed<T>(error: unknown): TeamActionResult<T> {
  return { ok: false, error: toClientSafeError(error).message };
}

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

/** Active internal colleagues, for the "start a conversation" picker. */
export async function listTeamMembersAction(): Promise<TeamActionResult<TeamMemberRow[]>> {
  try {
    const context = await getInternalContext();
    return { ok: true, data: await context.services.team.listMembers() };
  } catch (error) {
    return failed(error);
  }
}

export async function listTeamConversationsAction(): Promise<
  TeamActionResult<TeamConversationRow[]>
> {
  try {
    const context = await getInternalContext();
    return { ok: true, data: await context.services.team.listConversations() };
  } catch (error) {
    return failed(error);
  }
}

/**
 * The header badge's fuel.
 *
 * Never throws to the caller: the badge is ambient, and a transient failure
 * should leave the last known count on screen rather than tearing down the
 * command bar. Zero is returned only when the server genuinely said zero.
 */
export async function teamUnreadCountAction(): Promise<TeamActionResult<number>> {
  try {
    const context = await getInternalContext();
    return { ok: true, data: await context.services.team.unreadCount() };
  } catch (error) {
    return failed(error);
  }
}

export async function getTeamConversationAction(
  conversationId: string,
): Promise<TeamActionResult<TeamConversationDetailRow>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.getConversation({ conversationId }),
    };
  } catch (error) {
    return failed(error);
  }
}

/**
 * "Load older": one keyset page strictly before the caller's own oldest
 * loaded message, cursored on (created_at, id) rather than OFFSET.
 */
export async function listTeamMessagesBeforeAction(input: {
  conversationId: string;
  beforeCreatedAt: string;
  beforeId: string;
  limit?: number;
}): Promise<TeamActionResult<TeamMessagesBeforeRow>> {
  try {
    const context = await getInternalContext();
    return { ok: true, data: await context.services.team.listMessagesBefore(input) };
  } catch (error) {
    return failed(error);
  }
}

/**
 * The minimum architecture a search result click needs: a bounded window of
 * messages around one target, whether or not that target sits inside the
 * conversation pane's currently loaded range.
 */
export async function getTeamMessageWindowAction(input: {
  conversationId: string;
  messageId: string;
  before?: number;
  after?: number;
}): Promise<TeamActionResult<TeamMessageWindowRow>> {
  try {
    const context = await getInternalContext();
    return { ok: true, data: await context.services.team.getMessageWindow(input) };
  } catch (error) {
    return failed(error);
  }
}

/**
 * Conversation-scoped, server-side search. The server derives authorization
 * from the caller's own membership in the conversation; a non-member or a
 * client account is refused before any row is read, so search can never
 * become a side channel onto a conversation the caller cannot open.
 */
export async function searchTeamConversationMessagesAction(input: {
  conversationId: string;
  query: string;
  beforeCreatedAt?: string | null;
  beforeId?: string | null;
  limit?: number;
}): Promise<TeamActionResult<TeamSearchResponseRow>> {
  try {
    const context = await getInternalContext();
    return { ok: true, data: await context.services.team.searchMessages(input) };
  } catch (error) {
    return failed(error);
  }
}

/**
 * My Tasks, and — for a manage holder — Team Tasks.
 *
 * `includeTeam` is a request, never a grant. Without team_tasks.manage the
 * database silently returns only the actor's own assignments, so a browser that
 * sets the flag it was not offered simply receives My Tasks again.
 */
export async function listTeamTasksAction(
  includeTeam = false,
): Promise<TeamActionResult<TeamTaskListRow[]>> {
  try {
    const context = await getInternalContext();
    return { ok: true, data: await context.services.team.listMyTasks(includeTeam) };
  } catch (error) {
    return failed(error);
  }
}

/**
 * Refreshes this browser tab's opaque connection and returns only active
 * internal profile ids. The profile itself is always derived server-side.
 */
export async function touchTeamPresenceAction(
  connectionId: string,
): Promise<TeamActionResult<string[]>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.touchPresence(
        { connectionId },
        context.actor,
      ),
    };
  } catch (error) {
    return failed(error);
  }
}

// -----------------------------------------------------------------------------
// Mutations
// -----------------------------------------------------------------------------

/** Get-or-create the direct conversation with a colleague. */
export async function startTeamConversationAction(
  otherProfileId: string,
): Promise<TeamActionResult<string>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.startConversation({ otherProfileId }, context.actor),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function createTeamGroupAction(input: {
  title: string;
  memberProfileIds: string[];
}): Promise<TeamActionResult<string>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.createGroup(input, context.actor),
    };
  } catch (error) {
    return failed(error);
  }
}

/**
 * Send.
 *
 * `requestId` is a browser-generated idempotency key, not an identity claim: a
 * retry of the same draft replays the original row instead of producing a
 * second message, and the reused key is checked against the *server-derived*
 * author, so it cannot be used to claim somebody else's message.
 */
export async function sendTeamMessageAction(input: {
  requestId: string;
  conversationId: string;
  body: string;
}): Promise<TeamActionResult<TeamMessageWriteRow>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.sendMessage(input, context.actor),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function sendTeamReplyAction(input: {
  requestId: string;
  conversationId: string;
  body: string;
  replyToMessageId: string;
  replyQuoteText: string;
}): Promise<TeamActionResult<TeamMessageWriteRow>> {
  try {
    const context = await getInternalContext();
    return { ok: true, data: await context.services.team.sendReply(input, context.actor) };
  } catch (error) {
    return failed(error);
  }
}

export async function forwardTeamMessageAction(input: {
  requestId: string;
  sourceMessageId: string;
  destinationConversationId: string;
}): Promise<TeamActionResult<TeamMessageWriteRow>> {
  try {
    const context = await getInternalContext();
    return { ok: true, data: await context.services.team.forwardMessage(input, context.actor) };
  } catch (error) {
    return failed(error);
  }
}

export async function hideTeamMessageForMeAction(
  messageId: string,
): Promise<TeamActionResult<null>> {
  try {
    const context = await getInternalContext();
    await context.services.team.hideMessageForMe({ messageId }, context.actor);
    return { ok: true, data: null };
  } catch (error) {
    return failed(error);
  }
}

export async function deleteTeamMessageForEveryoneAction(
  messageId: string,
): Promise<TeamActionResult<null>> {
  try {
    const context = await getInternalContext();
    await context.services.team.deleteMessageForEveryone({ messageId }, context.actor);
    return { ok: true, data: null };
  } catch (error) {
    return failed(error);
  }
}

/**
 * Toggle one reaction on one message. The reactor is always auth.uid(); the
 * database re-derives conversation membership from the message itself, so a
 * message in a conversation the actor does not belong to can never be
 * reacted to no matter what this call is given.
 */
export async function toggleTeamMessageReactionAction(input: {
  messageId: string;
  reactionCode: string;
}): Promise<TeamActionResult<TeamReactionToggleRow>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.toggleReaction(input, context.actor),
    };
  } catch (error) {
    return failed(error);
  }
}

/** Moves this member's own read marker. There is no parameter for whose. */
export async function markTeamConversationReadAction(
  conversationId: string,
): Promise<TeamActionResult<null>> {
  try {
    const context = await getInternalContext();
    await context.services.team.markRead({ conversationId }, context.actor);
    return { ok: true, data: null };
  } catch (error) {
    return failed(error);
  }
}

export async function touchTeamTypingAction(input: {
  conversationId: string;
  connectionId: string;
}): Promise<TeamActionResult<null>> {
  try {
    const context = await getInternalContext();
    await context.services.team.touchTyping(input, context.actor);
    return { ok: true, data: null };
  } catch (error) {
    return failed(error);
  }
}

export async function clearTeamTypingAction(input: {
  conversationId: string;
  connectionId: string;
}): Promise<TeamActionResult<null>> {
  try {
    const context = await getInternalContext();
    await context.services.team.clearTyping(input, context.actor);
    return { ok: true, data: null };
  } catch (error) {
    return failed(error);
  }
}

/**
 * Create a real task inside a conversation — never decorated message text.
 *
 * `sourceMessageId` is what links a task back to the message it came from, and
 * the database refuses a source message that belongs to a different
 * conversation, so the link can never be pointed at a thread the actor cannot
 * read.
 */
export async function createTeamTaskAction(input: {
  requestId: string;
  conversationId: string;
  title: string;
  assignedToProfileId: string;
  description?: string | null;
  priority?: string;
  dueAt?: string | null;
  sourceMessageId?: string | null;
}): Promise<TeamActionResult<TeamTaskRow>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.createTask(
        { priority: "normal", ...input },
        context.actor,
      ),
    };
  } catch (error) {
    return failed(error);
  }
}

/** To Do / In Progress / Done. Assignee, creator or a manage holder only. */
export async function updateTeamTaskStatusAction(input: {
  taskId: string;
  status: string;
}): Promise<TeamActionResult<TeamTaskRow>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.updateTaskStatus(input, context.actor),
    };
  } catch (error) {
    return failed(error);
  }
}

/** Title, description, priority, due date and reassignment. Management only. */
export async function updateTeamTaskDetailsAction(input: {
  taskId: string;
  title?: string;
  description?: string | null;
  priority?: string;
  dueAt?: string | null;
  assignedToProfileId?: string;
}): Promise<TeamActionResult<TeamTaskRow>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.updateTaskDetails(input, context.actor),
    };
  } catch (error) {
    return failed(error);
  }
}

// -----------------------------------------------------------------------------
// Governance (V2.6)
//
// Owner and delegated-admin authority, Slow Mode and the task-creation policy
// are all re-derived and re-checked inside the RPCs these call — nothing here
// grants anything. See docs on team_conversation_admins and
// private.require_team_conversation_capability in the V2.6 migration.
// -----------------------------------------------------------------------------

export async function renameTeamConversationAction(input: {
  conversationId: string;
  title: string;
}): Promise<TeamActionResult<TeamConversationTitleRow>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.renameConversation(input, context.actor),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function setTeamConversationSlowModeAction(input: {
  conversationId: string;
  seconds: number | null;
  scope: "members_only" | "members_and_admins";
}): Promise<TeamActionResult<TeamConversationSlowModeRow>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.setSlowMode(input, context.actor),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function setTeamTaskCreationPolicyAction(input: {
  conversationId: string;
  policy: "owner_only" | "admins_and_owner" | "everyone";
}): Promise<TeamActionResult<TeamConversationTaskPolicyRow>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.setTaskCreationPolicy(input, context.actor),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function grantTeamConversationAdminAction(input: {
  conversationId: string;
  targetProfileId: string;
  capabilities: {
    manage_members?: boolean;
    manage_admins?: boolean;
    manage_slow_mode?: boolean;
    rename_conversation?: boolean;
    manage_task_policy?: boolean;
  };
}): Promise<TeamActionResult<TeamConversationAdminGrantRow>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.grantAdmin(input, context.actor),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function revokeTeamConversationAdminAction(input: {
  conversationId: string;
  targetProfileId: string;
}): Promise<TeamActionResult<TeamConversationMemberChangeRow>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.revokeAdmin(input, context.actor),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function addTeamConversationMemberAction(input: {
  conversationId: string;
  profileId: string;
}): Promise<TeamActionResult<TeamConversationMemberChangeRow>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.addMember(input, context.actor),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function removeTeamConversationMemberAction(input: {
  conversationId: string;
  profileId: string;
}): Promise<TeamActionResult<TeamConversationMemberChangeRow>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.team.removeMember(input, context.actor),
    };
  } catch (error) {
    return failed(error);
  }
}
