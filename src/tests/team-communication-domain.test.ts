import { describe, expect, it } from "vitest";
import {
  canMoveTeamTask,
  filterTeamMembers,
  formatTeamDayHeading,
  formatTeamDueLabel,
  formatTeamRelativeTime,
  groupTeamMessages,
  groupTeamTasksByStatus,
  nextTeamTaskStatus,
  sortTeamConversations,
  sortTeamTasks,
  teamInitials,
  teamTaskCounts,
  teamUnreadBadgeLabel,
  toTeamConversationDetailView,
  toTeamConversationViews,
  toTeamMemberView,
  toTeamMessageViews,
  toTeamTaskListViews,
  toTeamTaskView,
  totalTeamUnread,
  unnamedTeamMember,
} from "../domain/team/projections";
import {
  createTeamTaskSchema,
  sendTeamMessageSchema,
  teamMessageMaxLength,
  updateTeamTaskDetailsSchema,
  updateTeamTaskStatusSchema,
  type TeamConversationRow,
  type TeamMessageRow,
  type TeamTaskRow,
} from "../domain/team/schema";

/**
 * Team communication domain.
 *
 * These are the pure halves of the feature: the shapes a browser is allowed to
 * submit, and the view models the Messages workspace renders. Authorization is
 * not tested here because none of it lives here — conversation membership, the
 * messaging capability and the client refusal are all settled inside the
 * database, and 044_team_communication_tasks.test.sql is where that is proved.
 */

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";

function message(overrides: Partial<TeamMessageRow> & { id: string }): TeamMessageRow {
  return {
    conversation_id: CONVERSATION,
    author_profile_id: THEM,
    author_name: "Anthony Paghubasan",
    author_avatar_url: null,
    body: "Hello",
    created_at: "2026-08-26T09:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<TeamTaskRow> & { id: string }): TeamTaskRow {
  return {
    conversation_id: CONVERSATION,
    source_message_id: null,
    title: "Do the thing",
    description: null,
    status: "todo",
    priority: "normal",
    due_at: null,
    completed_at: null,
    created_at: "2026-08-26T09:00:00.000Z",
    updated_at: "2026-08-26T09:00:00.000Z",
    assigned_to_profile_id: ME,
    assigned_to_name: "William Jones",
    created_by_profile_id: THEM,
    created_by_name: "Anthony Paghubasan",
    ...overrides,
  };
}

describe("input contracts", () => {
  it("carries no author, sender or creator field for a browser to supply", () => {
    const keys = [
      ...Object.keys(sendTeamMessageSchema.shape),
      ...Object.keys(createTeamTaskSchema.shape),
    ];

    for (const forbidden of ["authorProfileId", "senderId", "createdByProfileId", "actorId"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("refuses a blank message and one past the database's own limit", () => {
    expect(sendTeamMessageSchema.safeParse({ requestId: ME, conversationId: CONVERSATION, body: "   " }).success).toBe(false);
    expect(
      sendTeamMessageSchema.safeParse({
        requestId: ME,
        conversationId: CONVERSATION,
        body: "x".repeat(teamMessageMaxLength + 1),
      }).success,
    ).toBe(false);
    expect(
      sendTeamMessageSchema.safeParse({ requestId: ME, conversationId: CONVERSATION, body: " hi " }).success,
    ).toBe(true);
  });

  it("defaults a new task to normal priority and refuses an unknown one", () => {
    const parsed = createTeamTaskSchema.parse({
      requestId: ME,
      conversationId: CONVERSATION,
      title: "Fix the layout",
      assignedToProfileId: THEM,
    });
    expect(parsed.priority).toBe("normal");

    expect(
      createTeamTaskSchema.safeParse({
        requestId: ME,
        conversationId: CONVERSATION,
        title: "Fix the layout",
        assignedToProfileId: THEM,
        priority: "catastrophic",
      }).success,
    ).toBe(false);
  });

  it("accepts only the three real statuses", () => {
    for (const status of ["todo", "in_progress", "done"]) {
      expect(updateTeamTaskStatusSchema.safeParse({ taskId: ME, status }).success).toBe(true);
    }
    /* Client vocabulary must not leak into internal task state. */
    for (const status of ["open", "closed", "awaiting_client", "resolved"]) {
      expect(updateTeamTaskStatusSchema.safeParse({ taskId: ME, status }).success).toBe(false);
    }
  });

  it("refuses an empty detail patch, so a no-op never reaches the database", () => {
    expect(updateTeamTaskDetailsSchema.safeParse({ taskId: ME }).success).toBe(false);
    expect(updateTeamTaskDetailsSchema.safeParse({ taskId: ME, priority: "high" }).success).toBe(true);
  });
});

describe("people", () => {
  it("builds initials from the first and last name, and never renders an empty row", () => {
    expect(teamInitials("William Jones")).toBe("WJ");
    expect(teamInitials("Anthony Bautista Paghubasan")).toBe("AP");
    expect(teamInitials("Cher")).toBe("CH");
    expect(teamInitials(null)).toBe("WF");
    expect(teamInitials("   ")).toBe("WF");
  });

  it("falls back to an honest label rather than inventing a name", () => {
    const view = toTeamMemberView({ profile_id: ME, display_name: null, avatar_url: null });
    expect(view.name).toBe(unnamedTeamMember);
    expect(view.initials).toBe("WF");
  });

  it("filters the picker case-insensitively", () => {
    const members = [
      toTeamMemberView({ profile_id: ME, display_name: "William Jones", email: "william@wolf-forge.com", avatar_url: null }),
      toTeamMemberView({ profile_id: THEM, display_name: "Anthony Paghubasan", email: "anthony@wolf-forge.com", avatar_url: null }),
    ];
    expect(filterTeamMembers(members, "anth").map((m) => m.name)).toEqual(["Anthony Paghubasan"]);
    expect(filterTeamMembers(members, "william@").map((m) => m.name)).toEqual(["William Jones"]);
    expect(filterTeamMembers(members, "  ")).toHaveLength(2);
  });
});

describe("conversations", () => {
  const rows: TeamConversationRow[] = [
    {
      conversation_id: "a",
      other_member_profile_id: THEM,
      other_member_name: "Anthony Paghubasan",
      other_member_avatar_url: null,
      last_message_preview: "  Subscription page is fixed  ",
      last_message_at: "2026-08-26T09:00:00.000Z",
      unread_count: 3,
      my_last_read_at: null,
    },
    {
      conversation_id: "b",
      other_member_profile_id: ME,
      other_member_name: "William Jones",
      other_member_avatar_url: null,
      last_message_preview: null,
      last_message_at: null,
      unread_count: 0,
      my_last_read_at: null,
    },
  ];

  it("trims the preview and reports unread honestly", () => {
    const [first, second] = toTeamConversationViews(rows);
    expect(first!.preview).toBe("Subscription page is fixed");
    expect(first!.hasUnread).toBe(true);
    expect(second!.preview).toBeNull();
    expect(second!.hasUnread).toBe(false);
    expect(totalTeamUnread(toTeamConversationViews(rows))).toBe(3);
  });

  it("sorts newest first and puts unstarted threads last", () => {
    const sorted = sortTeamConversations(toTeamConversationViews([rows[1]!, rows[0]!]));
    expect(sorted.map((c) => c.conversationId)).toEqual(["a", "b"]);
  });

  it("caps the header badge at 99+ and shows nothing at zero", () => {
    expect(teamUnreadBadgeLabel(0)).toBe("");
    expect(teamUnreadBadgeLabel(7)).toBe("7");
    expect(teamUnreadBadgeLabel(99)).toBe("99");
    expect(teamUnreadBadgeLabel(140)).toBe("99+");
  });
});

describe("message grouping", () => {
  it("starts a new run when the author changes", () => {
    const views = toTeamMessageViews(
      [
        message({ id: "1", author_profile_id: THEM, created_at: "2026-08-26T09:00:00.000Z" }),
        message({ id: "2", author_profile_id: THEM, created_at: "2026-08-26T09:01:00.000Z" }),
        message({ id: "3", author_profile_id: ME, created_at: "2026-08-26T09:02:00.000Z" }),
      ],
      ME,
    );

    const groups = groupTeamMessages(views);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.messages).toHaveLength(2);
    expect(groups[0]!.isMine).toBe(false);
    expect(groups[1]!.isMine).toBe(true);
  });

  it("breaks a run when the gap is long, even for the same author", () => {
    const views = toTeamMessageViews(
      [
        message({ id: "1", created_at: "2026-08-26T09:00:00.000Z" }),
        message({ id: "2", created_at: "2026-08-26T09:30:00.000Z" }),
      ],
      ME,
    );
    expect(groupTeamMessages(views, 8)).toHaveLength(2);
  });

  it("marks only the first group of each calendar day", () => {
    const views = toTeamMessageViews(
      [
        message({ id: "1", created_at: "2026-08-25T09:00:00.000Z" }),
        message({ id: "2", created_at: "2026-08-26T09:00:00.000Z" }),
        message({ id: "3", created_at: "2026-08-26T09:01:00.000Z", author_profile_id: ME }),
      ],
      ME,
    );

    const groups = groupTeamMessages(views);
    expect(groups.map((g) => g.startsDay)).toEqual([true, true, false]);
  });

  it("returns no groups for an empty thread", () => {
    expect(groupTeamMessages([])).toEqual([]);
  });

  it("labels today and yesterday by name and older days by date", () => {
    const now = new Date(2026, 7, 26, 12, 0, 0);
    expect(formatTeamDayHeading("2026-08-26", now)).toBe("Today");
    expect(formatTeamDayHeading("2026-08-25", now)).toBe("Yesterday");
    expect(formatTeamDayHeading("2026-08-01", now)).toMatch(/Aug/);
  });

  it("formats relative stamps coarsely", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");
    expect(formatTeamRelativeTime("2026-08-26T11:59:30.000Z", now)).toBe("now");
    expect(formatTeamRelativeTime("2026-08-26T11:30:00.000Z", now)).toBe("30m");
    expect(formatTeamRelativeTime("2026-08-26T08:00:00.000Z", now)).toBe("4h");
    expect(formatTeamRelativeTime("2026-08-24T12:00:00.000Z", now)).toBe("2d");
    expect(formatTeamRelativeTime(null, now)).toBe("");
  });
});

describe("tasks", () => {
  it("marks the actor's own assignments and treats a done task as never overdue", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");

    const overdue = toTeamTaskView(
      task({ id: "1", due_at: "2026-08-20T12:00:00.000Z" }),
      ME,
      now,
    );
    expect(overdue.isMine).toBe(true);
    expect(overdue.isOverdue).toBe(true);

    const finished = toTeamTaskView(
      task({ id: "2", due_at: "2026-08-20T12:00:00.000Z", status: "done", completed_at: "2026-08-21T00:00:00.000Z" }),
      ME,
      now,
    );
    expect(finished.isOverdue).toBe(false);

    const theirs = toTeamTaskView(task({ id: "3", assigned_to_profile_id: THEM }), ME, now);
    expect(theirs.isMine).toBe(false);
  });

  it("survives a status or priority this build does not know", () => {
    const view = toTeamTaskView(task({ id: "1", status: "escalated", priority: "critical" }), ME);
    expect(view.status).toBe("todo");
    expect(view.priority).toBe("normal");
  });

  it("words due dates by proximity", () => {
    const now = new Date(2026, 7, 26, 12, 0, 0);
    expect(formatTeamDueLabel(new Date(2026, 7, 26, 18).toISOString(), now)).toBe("Due today");
    expect(formatTeamDueLabel(new Date(2026, 7, 27, 18).toISOString(), now)).toBe("Due tomorrow");
    expect(formatTeamDueLabel(new Date(2026, 7, 25, 18).toISOString(), now)).toBe("Due yesterday");
    expect(formatTeamDueLabel(new Date(2026, 7, 21, 18).toISOString(), now)).toBe("5 days overdue");
    expect(formatTeamDueLabel(null, now)).toBeNull();
  });

  it("always produces all three status columns, empty ones included", () => {
    const board = groupTeamTasksByStatus([toTeamTaskView(task({ id: "1" }), ME)]);
    expect(board.map((column) => column.status)).toEqual(["todo", "in_progress", "done"]);
    expect(board[1]!.tasks).toEqual([]);
  });

  it("puts unfinished work first, then the soonest due, then the most urgent", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");
    const sorted = sortTeamTasks([
      toTeamTaskView(task({ id: "done", status: "done", completed_at: now.toISOString(), due_at: "2026-08-20T00:00:00.000Z" }), ME, now),
      toTeamTaskView(task({ id: "later", due_at: "2026-09-10T00:00:00.000Z", priority: "urgent" }), ME, now),
      toTeamTaskView(task({ id: "soon", due_at: "2026-08-27T00:00:00.000Z", priority: "low" }), ME, now),
    ]);

    /* A due date outranks priority: urgent-next-month loses to low-tomorrow. */
    expect(sorted.map((t) => t.id)).toEqual(["soon", "later", "done"]);
  });

  it("keeps the cross-conversation context column through sorting and grouping", () => {
    const views = toTeamTaskListViews(
      [{ ...task({ id: "1" }), other_member_name: "Anthony Paghubasan", is_mine: true }],
      ME,
    );
    const board = groupTeamTasksByStatus(sortTeamTasks(views));
    expect(board[0]!.tasks[0]!.otherMemberName).toBe("Anthony Paghubasan");
  });

  it("counts open work assigned to the actor for the Tasks tab badge", () => {
    const counts = teamTaskCounts([
      toTeamTaskView(task({ id: "1" }), ME),
      toTeamTaskView(task({ id: "2", status: "in_progress" }), ME),
      toTeamTaskView(task({ id: "3", status: "done", completed_at: "2026-08-26T00:00:00.000Z" }), ME),
      toTeamTaskView(task({ id: "4", assigned_to_profile_id: THEM }), ME),
    ]);

    expect(counts).toMatchObject({ total: 4, todo: 2, inProgress: 1, done: 1, openMine: 2 });
  });

  it("mirrors the database rule for who may move a card", () => {
    const mine = toTeamTaskView(task({ id: "1", assigned_to_profile_id: ME, created_by_profile_id: THEM }), ME);
    const theirs = toTeamTaskView(task({ id: "2", assigned_to_profile_id: THEM, created_by_profile_id: THEM }), ME);
    const authored = toTeamTaskView(task({ id: "3", assigned_to_profile_id: THEM, created_by_profile_id: ME }), ME);

    expect(canMoveTeamTask(mine, ME, false)).toBe(true);
    expect(canMoveTeamTask(authored, ME, false)).toBe(true);
    expect(canMoveTeamTask(theirs, ME, false)).toBe(false);
    /* A manage holder may move anything in a conversation they belong to. */
    expect(canMoveTeamTask(theirs, ME, true)).toBe(true);
  });

  it("cycles a single-click control through the workflow", () => {
    expect(nextTeamTaskStatus("todo")).toBe("in_progress");
    expect(nextTeamTaskStatus("in_progress")).toBe("done");
    expect(nextTeamTaskStatus("done")).toBe("todo");
  });
});

describe("conversation detail", () => {
  it("anchors each task to the message it was raised from", () => {
    const detail = toTeamConversationDetailView(
      {
        conversation_id: CONVERSATION,
        other_member: { profile_id: THEM, display_name: "Anthony Paghubasan", avatar_url: null },
        messages: [message({ id: "m1" }), message({ id: "m2" })],
        tasks: [
          task({ id: "t1", source_message_id: "m1" }),
          task({ id: "t2", source_message_id: "m1" }),
          task({ id: "t3", source_message_id: null }),
        ],
      },
      ME,
    );

    expect(detail.tasksBySourceMessage.get("m1")!.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(detail.tasksBySourceMessage.has("m2")).toBe(false);
    /* A task with no source message is never silently attached to one. */
    expect([...detail.tasksBySourceMessage.values()].flat().map((t) => t.id)).not.toContain("t3");
    expect(detail.otherMember!.name).toBe("Anthony Paghubasan");
  });

  it("handles a conversation with nothing in it yet", () => {
    const detail = toTeamConversationDetailView(
      { conversation_id: CONVERSATION, other_member: null, messages: [], tasks: [] },
      ME,
    );
    expect(detail.messages).toEqual([]);
    expect(detail.groups).toEqual([]);
    expect(detail.tasks).toEqual([]);
    expect(detail.otherMember).toBeNull();
  });
});
