import {
  isTeamTaskPriority,
  isTeamTaskStatus,
  teamReactionCodes,
  teamReactionEmoji,
  teamTaskStatuses,
  type TeamConversationAdminRow,
  type TeamConversationCapabilitiesRow,
  type TeamConversationDetailRow,
  type TeamConversationRow,
  type TeamMemberRow,
  type TeamMessageReactionRow,
  type TeamMessageRow,
  type TeamReactionCode,
  type TeamSearchResultRow,
  type TeamSlowModeScope,
  type TeamTaskCreationPolicy,
  type TeamTaskListRow,
  type TeamTaskPriority,
  type TeamTaskRow,
  type TeamTaskStatus,
} from "./schema";
import { parseTeamHighlightedSnippet, type TeamSnippetSegment } from "./formatting";

/**
 * Pure view models for the Messages workspace.
 *
 * Everything here is a total function of its input. No fetching, no clock
 * except the one explicitly passed in, and no authorization: whether the actor
 * may see a conversation at all was settled inside the database before any of
 * these rows existed.
 */

// -----------------------------------------------------------------------------
// People
// -----------------------------------------------------------------------------

export type TeamMemberView = {
  profileId: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  initials: string;
};

/**
 * A display name is nullable in the database, and a colleague who has not set
 * one still has to be reachable. This is the honest fallback: it never invents
 * a name and never renders an empty row.
 */
export const unnamedTeamMember = "Wolf Forge team member";

export function teamInitials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "WF";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toLocaleUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toLocaleUpperCase();
}

export function toTeamMemberView(row: TeamMemberRow): TeamMemberView {
  const name = row.display_name?.trim() || unnamedTeamMember;
  return {
    profileId: row.profile_id,
    name,
    email: row.email?.trim().toLocaleLowerCase() || null,
    avatarUrl: row.avatar_url?.trim() || null,
    initials: teamInitials(row.display_name),
  };
}

export function toTeamMemberViews(rows: TeamMemberRow[]): TeamMemberView[] {
  return rows.map(toTeamMemberView);
}

/** Display-name/email filter for the internal member picker. */
export function filterTeamMembers(members: TeamMemberView[], query: string): TeamMemberView[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return members;
  return members.filter(
    (member) =>
      member.name.toLocaleLowerCase().includes(needle) ||
      member.email?.includes(needle),
  );
}

// -----------------------------------------------------------------------------
// Conversations
// -----------------------------------------------------------------------------

export type TeamConversationView = {
  conversationId: string;
  kind: "direct" | "group";
  name: string;
  memberCount: number;
  otherMember: TeamMemberView | null;
  lastMessageId: string | null;
  lastMessageType: "text" | "task_activity" | "governance_activity" | null;
  lastAuthorProfileId: string | null;
  lastAuthorName: string | null;
  lastAuthorAvatarUrl: string | null;
  preview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  hasUnread: boolean;
  destinationSearchText: string;
};

export function toTeamConversationView(row: TeamConversationRow): TeamConversationView {
  const unread = Number.isFinite(row.unread_count) ? Math.max(0, row.unread_count) : 0;
  const kind = row.conversation_kind === "group" ? "group" : "direct";
  const otherMember = row.other_member_profile_id
    ? toTeamMemberView({
        profile_id: row.other_member_profile_id,
        display_name: row.other_member_name,
        email: null,
        avatar_url: row.other_member_avatar_url,
      })
    : null;

  return {
    conversationId: row.conversation_id,
    kind,
    name:
      kind === "group"
        ? row.conversation_title?.trim() || "Team group"
        : otherMember?.name ?? unnamedTeamMember,
    memberCount: Math.max(kind === "group" ? 3 : 2, row.member_count ?? 0),
    otherMember,
    lastMessageId: row.last_message_id ?? null,
    lastMessageType: row.last_message_type ?? null,
    lastAuthorProfileId: row.last_message_author_profile_id ?? null,
    lastAuthorName: row.last_message_author_name?.trim() || null,
    lastAuthorAvatarUrl: row.last_message_author_avatar_url?.trim() || null,
    preview: row.last_message_preview?.trim() || null,
    lastMessageAt: row.last_message_at,
    unreadCount: unread,
    hasUnread: unread > 0,
    destinationSearchText: row.destination_search_text?.trim() || "",
  };
}

export function toTeamConversationViews(rows: TeamConversationRow[]): TeamConversationView[] {
  return rows.map(toTeamConversationView);
}

/**
 * Newest conversation first, unstarted threads last.
 *
 * The RPC already orders this way; restating it keeps the list honest after an
 * optimistic local insert, which arrives out of order by definition.
 */
export function sortTeamConversations(views: TeamConversationView[]): TeamConversationView[] {
  return [...views].sort((left, right) => {
    if (left.lastMessageAt === right.lastMessageAt) {
      return left.conversationId.localeCompare(right.conversationId);
    }
    if (!left.lastMessageAt) return 1;
    if (!right.lastMessageAt) return -1;
    return right.lastMessageAt.localeCompare(left.lastMessageAt);
  });
}

export function totalTeamUnread(views: TeamConversationView[]): number {
  return views.reduce((total, view) => total + view.unreadCount, 0);
}

/** The header badge caps at 99+, matching the notification bell's language. */
export function teamUnreadBadgeLabel(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

/** One reaction code's aggregate, ready to render as a chip. */
export type TeamReactionView = {
  code: TeamReactionCode;
  emoji: string;
  count: number;
  reactedByMe: boolean;
  /** Compact reactor list for the chip's tooltip. Never empty when count > 0. */
  reactorNames: string[];
};

/** Quick actions first, then the picker set, matching the rail's own order. */
const teamReactionDisplayOrder: Record<TeamReactionCode, number> = Object.fromEntries(
  teamReactionCodes.map((code, index) => [code, index]),
) as Record<TeamReactionCode, number>;

/**
 * Never renders a zero-count chip: a reaction that settles back to zero
 * (every reactor toggled off) simply disappears rather than sitting as an
 * empty husk.
 */
export function toTeamReactionViews(rows: TeamMessageReactionRow[] | undefined): TeamReactionView[] {
  if (!rows || rows.length === 0) return [];
  return rows
    .filter((row): row is TeamMessageReactionRow & { reaction_code: TeamReactionCode } =>
      teamReactionCodes.includes(row.reaction_code as TeamReactionCode) && row.reaction_count > 0,
    )
    .map((row) => ({
      code: row.reaction_code,
      emoji: teamReactionEmoji[row.reaction_code],
      count: row.reaction_count,
      reactedByMe: row.reacted_by_me,
      reactorNames: row.reactor_names.map((name) => name?.trim() || unnamedTeamMember),
    }))
    .sort((left, right) => teamReactionDisplayOrder[left.code] - teamReactionDisplayOrder[right.code]);
}

export type TeamMessageView = {
  id: string;
  requestId: string | null;
  conversationId: string;
  authorProfileId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorInitials: string;
  body: string;
  messageType: "text" | "task_activity" | "governance_activity";
  taskId: string | null;
  taskAction: "completed" | "reopened" | "created" | null;
  createdAt: string;
  /** True for the signed-in actor's own messages, which render on the right. */
  isMine: boolean;
  /** Set while an optimistic message has not been confirmed by the server. */
  pending?: boolean;
  /** Set when the send failed and the bubble offers a retry. */
  failed?: boolean;
  reactions: TeamReactionView[];
  replyToMessageId: string | null;
  replyQuoteText: string | null;
  replySourceAuthorName: string | null;
  replySourceDeleted: boolean;
  forwardedFromMessageId: string | null;
  forwardedFromAuthorName: string | null;
  deletedForEveryone: boolean;
};

export function toTeamMessageView(row: TeamMessageRow, actorProfileId: string): TeamMessageView {
  return {
    id: row.id,
    requestId: row.request_id ?? null,
    conversationId: row.conversation_id,
    authorProfileId: row.author_profile_id,
    authorName: row.author_name?.trim() || unnamedTeamMember,
    authorAvatarUrl: row.author_avatar_url?.trim() || null,
    authorInitials: teamInitials(row.author_name),
    body: row.body,
    messageType:
      row.message_type === "task_activity" || row.message_type === "governance_activity"
        ? row.message_type
        : "text",
    taskId: row.task_id ?? null,
    taskAction:
      row.task_action === "completed" ||
      row.task_action === "reopened" ||
      row.task_action === "created"
        ? row.task_action
        : null,
    createdAt: row.created_at,
    isMine: row.author_profile_id === actorProfileId,
    reactions: toTeamReactionViews(row.reactions),
    replyToMessageId: row.reply_to_message_id ?? null,
    replyQuoteText: row.reply_quote_text?.trim() || null,
    replySourceAuthorName: row.reply_source_author_name?.trim() || null,
    replySourceDeleted: row.reply_source_deleted === true,
    forwardedFromMessageId: row.forwarded_from_message_id ?? null,
    forwardedFromAuthorName: row.forwarded_from_author_name?.trim() || null,
    deletedForEveryone: row.deleted_for_everyone === true,
  };
}

export function toTeamMessageViews(
  rows: TeamMessageRow[],
  actorProfileId: string,
): TeamMessageView[] {
  return rows.map((row) => toTeamMessageView(row, actorProfileId));
}

/**
 * The optimistic half of a reaction toggle. Pure and total, so the click
 * handler can apply it on the same frame the reaction rail was clicked, before
 * the round trip to `app_toggle_team_message_reaction` resolves.
 *
 * The server remains the authority: the live lane resends the true aggregate
 * (including reactor names) on its next tick regardless, which self-heals the
 * approximate local name list this function builds. On a failed request the
 * caller restores its own snapshot of the message taken before calling this,
 * rather than trying to compute an exact inverse.
 */
export function applyOptimisticTeamReactionToggle(
  message: TeamMessageView,
  code: TeamReactionCode,
  actorDisplayName: string | null,
): TeamMessageView {
  const actorLabel = actorDisplayName?.trim() || unnamedTeamMember;
  const existing = message.reactions.find((reaction) => reaction.code === code);

  if (!existing) {
    const added: TeamReactionView = {
      code,
      emoji: teamReactionEmoji[code],
      count: 1,
      reactedByMe: true,
      reactorNames: [actorLabel],
    };
    return {
      ...message,
      reactions: [...message.reactions, added].sort(
        (left, right) => teamReactionDisplayOrder[left.code] - teamReactionDisplayOrder[right.code],
      ),
    };
  }

  if (!existing.reactedByMe) {
    return {
      ...message,
      reactions: message.reactions.map((reaction) =>
        reaction.code === code
          ? {
              ...reaction,
              count: reaction.count + 1,
              reactedByMe: true,
              reactorNames: [...reaction.reactorNames, actorLabel],
            }
          : reaction,
      ),
    };
  }

  const nextCount = existing.count - 1;
  if (nextCount <= 0) {
    return {
      ...message,
      reactions: message.reactions.filter((reaction) => reaction.code !== code),
    };
  }

  let removedOne = false;
  return {
    ...message,
    reactions: message.reactions.map((reaction) => {
      if (reaction.code !== code) return reaction;
      const reactorNames = reaction.reactorNames.filter((name) => {
        if (removedOne || name !== actorLabel) return true;
        removedOne = true;
        return false;
      });
      return { ...reaction, count: nextCount, reactedByMe: false, reactorNames };
    }),
  };
}

/**
 * A run of consecutive messages from one author, inside one calendar day.
 *
 * Grouping is what turns a transcript into a conversation: the avatar and the
 * name appear once per run instead of once per line, and the day heading only
 * appears when the day actually changes.
 */
export type TeamMessageGroup = {
  key: string;
  authorProfileId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorInitials: string;
  isMine: boolean;
  /** Local calendar day (YYYY-MM-DD), used for the day heading. */
  day: string;
  /** True when this group opens a new calendar day. */
  startsDay: boolean;
  messages: TeamMessageView[];
};

function localDayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * A new group starts when the author changes, the calendar day changes, or the
 * gap since the previous message exceeds `gapMinutes`. The gap rule is what
 * stops a reply sent the next morning from being glued onto last night's run.
 */
export function groupTeamMessages(
  messages: TeamMessageView[],
  gapMinutes = 8,
): TeamMessageGroup[] {
  const groups: TeamMessageGroup[] = [];
  const gapMs = gapMinutes * 60_000;
  let previousDay: string | null = null;

  for (const message of messages) {
    const day = localDayKey(message.createdAt);
    const current = groups[groups.length - 1];
    const previous = current?.messages[current.messages.length - 1];

    const withinGap =
      previous !== undefined &&
      Math.abs(
        new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime(),
      ) <= gapMs;

    if (
      current &&
      current.authorProfileId === message.authorProfileId &&
      message.messageType === "text" &&
      previous?.messageType === "text" &&
      current.day === day &&
      withinGap
    ) {
      current.messages.push(message);
      continue;
    }

    groups.push({
      key: message.id,
      authorProfileId: message.authorProfileId,
      authorName: message.authorName,
      authorAvatarUrl: message.authorAvatarUrl,
      authorInitials: message.authorInitials,
      isMine: message.isMine,
      day,
      startsDay: day !== previousDay,
      messages: [message],
    });
    previousDay = day;
  }

  return groups;
}

/** "Today" / "Yesterday" / "12 Aug" for a day heading. */
export function formatTeamDayHeading(day: string, now: Date = new Date()): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const target = new Date(year, month - 1, date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    ...(target.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  }).format(target);
}

/** The short time stamp on a bubble. */
export function formatTeamMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date);
}

/**
 * The relative stamp on a conversation row: minutes, hours, days, then a date.
 * Deliberately coarse — a conversation list is scanned, not read.
 */
export function formatTeamRelativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

// -----------------------------------------------------------------------------
// Conversation history search
// -----------------------------------------------------------------------------

export type TeamSearchResultView = {
  id: string;
  authorProfileId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  authorInitials: string;
  createdAt: string;
  /** The date line under the sender: "Aug 12, 2026". */
  dateLabel: string;
  /** Plain-text-plus-highlight segments, never HTML. */
  segments: TeamSnippetSegment[];
};

/** "12 Aug 2026" — a search result reads as history, so the year always shows. */
export function formatTeamSearchResultDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function toTeamSearchResultView(row: TeamSearchResultRow): TeamSearchResultView {
  return {
    id: row.id,
    authorProfileId: row.author_profile_id,
    authorName: row.author_name?.trim() || unnamedTeamMember,
    authorAvatarUrl: row.author_avatar_url?.trim() || null,
    authorInitials: teamInitials(row.author_name),
    createdAt: row.created_at,
    dateLabel: formatTeamSearchResultDate(row.created_at),
    segments: parseTeamHighlightedSnippet(row.snippet),
  };
}

export function toTeamSearchResultViews(rows: TeamSearchResultRow[]): TeamSearchResultView[] {
  return rows.map(toTeamSearchResultView);
}

// -----------------------------------------------------------------------------
// Tasks
// -----------------------------------------------------------------------------

export type TeamTaskView = {
  id: string;
  conversationId: string;
  sourceMessageId: string | null;
  title: string;
  description: string | null;
  status: TeamTaskStatus;
  priority: TeamTaskPriority;
  dueAt: string | null;
  completedAt: string | null;
  completedByProfileId: string | null;
  createdAt: string;
  updatedAt: string;
  assignedToProfileId: string;
  assignedToName: string;
  createdByProfileId: string;
  createdByName: string;
  /** Assigned to the signed-in actor. */
  isMine: boolean;
  /** Past its due date and not finished. A done task is never overdue. */
  isOverdue: boolean;
  dueLabel: string | null;
};

/**
 * An unrecognised status or priority would mean the database grew a value this
 * build does not know. Falling back keeps the card visible and actionable
 * instead of collapsing the whole conversation behind a parse error.
 */
function safeStatus(value: string): TeamTaskStatus {
  return isTeamTaskStatus(value) ? value : "todo";
}

function safePriority(value: string): TeamTaskPriority {
  return isTeamTaskPriority(value) ? value : "normal";
}

/** "Overdue" is a fact about the clock; "Due today" and "Due Tue" are its softer neighbours. */
export function formatTeamDueLabel(dueAt: string | null, now: Date = new Date()): string | null {
  if (!dueAt) return null;
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return null;

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((dueDay.getTime() - startOfDay.getTime()) / 86_400_000);

  if (diffDays < 0) {
    return diffDays === -1 ? "Due yesterday" : `${Math.abs(diffDays)} days overdue`;
  }
  if (diffDays === 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";
  if (diffDays < 7) {
    return `Due ${new Intl.DateTimeFormat("en", { weekday: "short" }).format(date)}`;
  }

  return `Due ${new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date)}`;
}

export function toTeamTaskView(
  row: TeamTaskRow,
  actorProfileId: string,
  now: Date = new Date(),
): TeamTaskView {
  const status = safeStatus(row.status);
  const overdue =
    status !== "done" && Boolean(row.due_at) && new Date(row.due_at!).getTime() < now.getTime();

  return {
    id: row.id,
    conversationId: row.conversation_id,
    sourceMessageId: row.source_message_id,
    title: row.title,
    description: row.description?.trim() || null,
    status,
    priority: safePriority(row.priority),
    dueAt: row.due_at,
    completedAt: row.completed_at,
    completedByProfileId: row.completed_by_profile_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignedToProfileId: row.assigned_to_profile_id,
    assignedToName: row.assigned_to_name?.trim() || unnamedTeamMember,
    createdByProfileId: row.created_by_profile_id,
    createdByName: row.created_by_name?.trim() || unnamedTeamMember,
    isMine: row.assigned_to_profile_id === actorProfileId,
    isOverdue: overdue,
    dueLabel: formatTeamDueLabel(row.due_at, now),
  };
}

export function toTeamTaskViews(
  rows: TeamTaskRow[],
  actorProfileId: string,
  now: Date = new Date(),
): TeamTaskView[] {
  return rows.map((row) => toTeamTaskView(row, actorProfileId, now));
}

/** The cross-conversation list adds who the other party is. */
export type TeamTaskListView = TeamTaskView & {
  conversationKind: "direct" | "group";
  conversationName: string | null;
  otherMemberName: string | null;
};

export function toTeamTaskListViews(
  rows: TeamTaskListRow[],
  actorProfileId: string,
  now: Date = new Date(),
): TeamTaskListView[] {
  return rows.map((row) => ({
    ...toTeamTaskView(row, actorProfileId, now),
    conversationKind: row.conversation_kind === "group" ? "group" : "direct",
    conversationName:
      row.conversation_name?.trim() || row.other_member_name?.trim() || null,
    otherMemberName: row.other_member_name?.trim() || null,
  }));
}

/**
 * The three status columns, always all three and always in workflow order, so
 * an empty column still renders its own empty state rather than vanishing.
 */
export type TeamTaskBoard<Task extends TeamTaskView = TeamTaskView> = Array<{
  status: TeamTaskStatus;
  tasks: Task[];
}>;

/**
 * Generic over the task shape so the cross-conversation list keeps the extra
 * context it carries. Narrowing to TeamTaskView here would silently drop
 * `otherMemberName` on the way into the Tasks panel.
 */
export function groupTeamTasksByStatus<Task extends TeamTaskView>(
  tasks: Task[],
): TeamTaskBoard<Task> {
  return teamTaskStatuses.map((status) => ({
    status,
    tasks: tasks.filter((task) => task.status === status),
  }));
}

const priorityWeight: Record<TeamTaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/**
 * Unfinished before finished, then soonest due, then most urgent, then newest.
 *
 * Due date outranks priority on purpose: an urgent task due next month is not
 * the thing to do before a normal one due this afternoon.
 */
export function sortTeamTasks<Task extends TeamTaskView>(tasks: Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    const done = Number(left.status === "done") - Number(right.status === "done");
    if (done !== 0) return done;

    const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;

    const priority = priorityWeight[left.priority] - priorityWeight[right.priority];
    if (priority !== 0) return priority;

    return right.createdAt.localeCompare(left.createdAt);
  });
}

export type TeamTaskCounts = {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  overdue: number;
  /** Open work assigned to the actor — the number the Tasks tab badges. */
  openMine: number;
};

export function teamTaskCounts(tasks: TeamTaskView[]): TeamTaskCounts {
  return {
    total: tasks.length,
    todo: tasks.filter((task) => task.status === "todo").length,
    inProgress: tasks.filter((task) => task.status === "in_progress").length,
    done: tasks.filter((task) => task.status === "done").length,
    overdue: tasks.filter((task) => task.isOverdue).length,
    openMine: tasks.filter((task) => task.isMine && task.status !== "done").length,
  };
}

/**
 * Who may move a card, mirroring `app_update_team_task_status`.
 *
 * Presentation only. The database refuses the move regardless of what the
 * browser decided to render; this exists so a disabled control matches the
 * refusal instead of inviting an error.
 */
export function canMoveTeamTask(
  task: TeamTaskView,
  actorProfileId: string,
  canManageTasks: boolean,
): boolean {
  return (
    canManageTasks ||
    task.assignedToProfileId === actorProfileId ||
    task.createdByProfileId === actorProfileId
  );
}

/** The next status a single-click control should move a card to. */
export function nextTeamTaskStatus(status: TeamTaskStatus): TeamTaskStatus {
  if (status === "todo") return "in_progress";
  if (status === "in_progress") return "done";
  return "todo";
}

// -----------------------------------------------------------------------------
// Conversation detail
// -----------------------------------------------------------------------------

export type TeamConversationAdminView = TeamMemberView & {
  canManageMembers: boolean;
  canManageAdmins: boolean;
  canManageSlowMode: boolean;
  canRenameConversation: boolean;
  canManageTaskPolicy: boolean;
};

export type TeamConversationCapabilitiesView = {
  isOwner: boolean;
  canCreateTask: boolean;
  canManageMembers: boolean;
  canManageAdmins: boolean;
  canManageSlowMode: boolean;
  canRenameConversation: boolean;
  canManageTaskPolicy: boolean;
};

const defaultTeamConversationCapabilities: TeamConversationCapabilitiesView = {
  isOwner: false,
  canCreateTask: false,
  canManageMembers: false,
  canManageAdmins: false,
  canManageSlowMode: false,
  canRenameConversation: false,
  canManageTaskPolicy: false,
};

function toTeamConversationCapabilitiesView(
  row: TeamConversationCapabilitiesRow | undefined,
): TeamConversationCapabilitiesView {
  if (!row) return defaultTeamConversationCapabilities;
  return {
    isOwner: row.is_owner,
    canCreateTask: row.can_create_task,
    canManageMembers: row.can_manage_members,
    canManageAdmins: row.can_manage_admins,
    canManageSlowMode: row.can_manage_slow_mode,
    canRenameConversation: row.can_rename_conversation,
    canManageTaskPolicy: row.can_manage_task_policy,
  };
}

function toTeamConversationAdminViews(rows: TeamConversationAdminRow[]): TeamConversationAdminView[] {
  return rows.map((row) => ({
    ...toTeamMemberView(row),
    canManageMembers: row.can_manage_members,
    canManageAdmins: row.can_manage_admins,
    canManageSlowMode: row.can_manage_slow_mode,
    canRenameConversation: row.can_rename_conversation,
    canManageTaskPolicy: row.can_manage_task_policy,
  }));
}

export type TeamConversationDetailView = {
  conversationId: string;
  kind: "direct" | "group";
  title: string | null;
  name: string;
  members: TeamMemberView[];
  typingMembers: TeamMemberView[];
  otherMember: TeamMemberView | null;
  messages: TeamMessageView[];
  groups: TeamMessageGroup[];
  tasks: TeamTaskView[];
  /** Task cards keyed by the message they were created from. */
  tasksBySourceMessage: Map<string, TeamTaskView[]>;
  /** Every task keyed by its own id — how a `created` activity row finds its card. */
  tasksById: Map<string, TeamTaskView>;
  ownerProfileId: string | null;
  admins: TeamConversationAdminView[];
  capabilities: TeamConversationCapabilitiesView;
  slowModeSeconds: number | null;
  slowModeScope: TeamSlowModeScope;
  taskCreationPolicy: TeamTaskCreationPolicy;
  /** Set only while a Slow Mode cooldown is actively blocking my next send. */
  myNextAllowedSendAt: string | null;
};

export function toTeamConversationDetailView(
  row: TeamConversationDetailRow,
  actorProfileId: string,
  now: Date = new Date(),
): TeamConversationDetailView {
  const messages = toTeamMessageViews(row.messages ?? [], actorProfileId);
  const tasks = toTeamTaskViews(row.tasks ?? [], actorProfileId, now);
  const kind = row.conversation_kind === "group" ? "group" : "direct";
  const members = toTeamMemberViews(row.members ?? []);
  const otherMember = row.other_member
    ? toTeamMemberView({
        profile_id: row.other_member.profile_id,
        display_name: row.other_member.display_name,
        avatar_url: row.other_member.avatar_url,
      })
    : null;

  const tasksBySourceMessage = new Map<string, TeamTaskView[]>();
  const tasksById = new Map<string, TeamTaskView>();
  for (const task of tasks) {
    tasksById.set(task.id, task);
    if (!task.sourceMessageId) continue;
    const bucket = tasksBySourceMessage.get(task.sourceMessageId);
    if (bucket) bucket.push(task);
    else tasksBySourceMessage.set(task.sourceMessageId, [task]);
  }

  const myNextAllowedSendAt =
    row.my_next_allowed_send_at && new Date(row.my_next_allowed_send_at).getTime() > now.getTime()
      ? row.my_next_allowed_send_at
      : null;

  return {
    conversationId: row.conversation_id,
    kind,
    title: row.conversation_title?.trim() || null,
    name:
      kind === "group"
        ? row.conversation_title?.trim() || "Team group"
        : otherMember?.name ?? "Conversation",
    members,
    typingMembers: toTeamMemberViews(row.typing ?? []),
    otherMember,
    messages,
    groups: groupTeamMessages(messages),
    tasks,
    tasksBySourceMessage,
    tasksById,
    ownerProfileId: row.owner_profile_id ?? null,
    admins: toTeamConversationAdminViews(row.admins ?? []),
    capabilities: toTeamConversationCapabilitiesView(row.my_capabilities),
    slowModeSeconds: row.slow_mode_seconds ?? null,
    slowModeScope: row.slow_mode_scope ?? "members_and_admins",
    taskCreationPolicy: row.task_creation_policy ?? "everyone",
    myNextAllowedSendAt,
  };
}

/**
 * Folds a page of history — older messages, or a jump-to-message window —
 * into what is already loaded. De-duplicated by id and re-sorted by
 * (createdAt, id), so a window fetch that overlaps the currently loaded range
 * (the common case right after a jump) never produces a repeated bubble.
 */
export function mergeTeamMessageViews(
  existing: TeamMessageView[],
  incoming: TeamMessageView[],
): TeamMessageView[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => {
    if (left.createdAt === right.createdAt) return left.id.localeCompare(right.id);
    return left.createdAt.localeCompare(right.createdAt);
  });
}

// -----------------------------------------------------------------------------
// Task activity, typing, and optimistic reconciliation
// -----------------------------------------------------------------------------

/**
 * The one-line sentence a `task_activity` message renders as.
 *
 * The database stores the task TITLE in `body` and the verb in `task_action`,
 * rather than a pre-composed sentence, so the wording stays a presentation
 * decision and an already-written row never has to be rewritten to change it.
 */
export function teamActivityLabel(message: TeamMessageView): string {
  if (message.taskAction === "created") {
    return `${message.authorName} created a task`;
  }
  const verb = message.taskAction === "reopened" ? "reopened" : "completed";
  return `${message.authorName} ${verb} "${message.body}"`;
}

/**
 * "Anthony is typing…" — the sentence under the header while others compose.
 *
 * Named rather than anonymous because a group thread has to say WHO, and the
 * list is capped so six simultaneous typers cannot push the transcript down.
 */
export function teamTypingLabel(members: TeamMemberView[]): string | null {
  if (members.length === 0) return null;
  if (members.length === 1) return `${members[0]!.name} is typing…`;
  if (members.length === 2) {
    return `${members[0]!.name} and ${members[1]!.name} are typing…`;
  }
  return `${members[0]!.name} and ${members.length - 1} others are typing…`;
}

/**
 * Which optimistic messages are still genuinely in flight.
 *
 * Matched on `requestId`, which is the idempotency key the browser minted and
 * the database echoes back on both the fresh insert and the replay path. A
 * body+author match — the obvious shortcut — silently swallows the second of
 * two identical messages ("ok" twice), so the key is what keeps a real repeat
 * visible while still retiring the bubble it belongs to.
 *
 * A failed message is never retired: it is waiting for the viewer, not the
 * server.
 */
export function stillPendingTeamMessages(
  pending: TeamMessageView[],
  confirmed: TeamMessageView[],
): TeamMessageView[] {
  if (pending.length === 0) return pending;
  const confirmedRequestIds = new Set(
    confirmed.map((message) => message.requestId).filter((id): id is string => Boolean(id)),
  );
  return pending.filter(
    (message) => message.failed || !confirmedRequestIds.has(message.requestId ?? ""),
  );
}
