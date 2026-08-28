import { describe, expect, it } from "vitest";
import {
  teamActivityLabel,
  toTeamConversationDetailView,
  toTeamMessageView,
  toTeamMessageViews,
} from "../domain/team/projections";
import {
  grantTeamConversationAdminSchema,
  setTeamConversationSlowModeSchema,
  teamSlowModeMaxSeconds,
  type TeamConversationAdminRow,
  type TeamConversationCapabilitiesRow,
  type TeamMessageRow,
} from "../domain/team/schema";

/**
 * Team Communication V2.6 — conversation governance domain layer.
 *
 * Authorization itself (owner exemption, delegated-capability escalation
 * limits, Slow Mode race safety, task-creation policy authority) is proved in
 * 054_team_communication_v26_governance.test.sql, where it actually lives.
 * This file covers only the pure projections and input contracts: the row a
 * governance RPC returns is trusted input here, not re-derived authorization.
 */

const ME = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";

function message(overrides: Partial<TeamMessageRow> & { id: string }): TeamMessageRow {
  return {
    conversation_id: CONVERSATION,
    author_profile_id: OWNER,
    author_name: "Aria Owner",
    author_avatar_url: null,
    body: "Do the thing",
    created_at: "2026-08-28T09:00:00.000Z",
    ...overrides,
  };
}

describe("task_activity 'created' and governance_activity rows", () => {
  it("projects the new message_type and task_action without falling back to text/null", () => {
    const [created] = toTeamMessageViews(
      [
        message({
          id: "m1",
          message_type: "task_activity",
          task_id: "t1",
          task_action: "created",
        }),
      ],
      ME,
    );
    expect(created!.messageType).toBe("task_activity");
    expect(created!.taskAction).toBe("created");
    expect(created!.taskId).toBe("t1");
  });

  it("projects governance_activity as its own message_type, not text", () => {
    const view = toTeamMessageView(
      message({ id: "m2", message_type: "governance_activity", body: "Aria renamed this group to X" }),
      ME,
    );
    expect(view.messageType).toBe("governance_activity");
    expect(view.taskAction).toBeNull();
  });

  it("still falls back to text for an unrecognized message_type (forward compatibility)", () => {
    const view = toTeamMessageView(
      { ...message({ id: "m3" }), message_type: "something_new" } as unknown as TeamMessageRow,
      ME,
    );
    expect(view.messageType).toBe("text");
  });
});

describe("teamActivityLabel", () => {
  it("reads 'created' as its own verb, not the completed/reopened default", () => {
    const view = toTeamMessageView(
      message({
        id: "m1",
        message_type: "task_activity",
        task_id: "t1",
        task_action: "created",
        author_name: "Ben Member",
        body: "Composer task",
      }),
      ME,
    );
    expect(teamActivityLabel(view)).toBe("Ben Member created a task");
  });

  it("keeps the existing completed/reopened wording, quoting the task title", () => {
    const completed = toTeamMessageView(
      message({
        id: "m1",
        message_type: "task_activity",
        task_id: "t1",
        task_action: "completed",
        author_name: "Ben Member",
        body: "Composer task",
      }),
      ME,
    );
    expect(teamActivityLabel(completed)).toBe('Ben Member completed "Composer task"');
  });
});

describe("conversation detail: governance state", () => {
  const capabilities: TeamConversationCapabilitiesRow = {
    is_owner: false,
    can_create_task: true,
    can_manage_members: true,
    can_manage_admins: false,
    can_manage_slow_mode: false,
    can_rename_conversation: true,
    can_manage_task_policy: false,
  };

  const admins: TeamConversationAdminRow[] = [
    {
      profile_id: ME,
      display_name: "Ben Member",
      avatar_url: null,
      can_manage_members: true,
      can_manage_admins: false,
      can_manage_slow_mode: false,
      can_rename_conversation: true,
      can_manage_task_policy: false,
    },
  ];

  it("maps owner, admins, capabilities and policy from snake_case rows to a camelCase view", () => {
    const detail = toTeamConversationDetailView(
      {
        conversation_id: CONVERSATION,
        conversation_kind: "group",
        conversation_title: "V26 Pod",
        owner_profile_id: OWNER,
        slow_mode_seconds: 30,
        slow_mode_scope: "members_only",
        task_creation_policy: "admins_and_owner",
        my_capabilities: capabilities,
        admins,
        other_member: null,
        messages: [],
        tasks: [],
      },
      ME,
    );

    expect(detail.ownerProfileId).toBe(OWNER);
    expect(detail.slowModeSeconds).toBe(30);
    expect(detail.slowModeScope).toBe("members_only");
    expect(detail.taskCreationPolicy).toBe("admins_and_owner");
    expect(detail.capabilities).toEqual({
      isOwner: false,
      canCreateTask: true,
      canManageMembers: true,
      canManageAdmins: false,
      canManageSlowMode: false,
      canRenameConversation: true,
      canManageTaskPolicy: false,
    });
    expect(detail.admins).toEqual([
      {
        profileId: ME,
        name: "Ben Member",
        email: null,
        avatarUrl: null,
        initials: "BM",
        canManageMembers: true,
        canManageAdmins: false,
        canManageSlowMode: false,
        canRenameConversation: true,
        canManageTaskPolicy: false,
      },
    ]);
  });

  it("defaults to the safe, permission-nothing state when the RPC omits governance fields (legacy/partial rows)", () => {
    const detail = toTeamConversationDetailView(
      { conversation_id: CONVERSATION, other_member: null, messages: [], tasks: [] },
      ME,
    );
    expect(detail.ownerProfileId).toBeNull();
    expect(detail.admins).toEqual([]);
    expect(detail.slowModeSeconds).toBeNull();
    expect(detail.slowModeScope).toBe("members_and_admins");
    expect(detail.taskCreationPolicy).toBe("everyone");
    expect(detail.capabilities.isOwner).toBe(false);
    expect(detail.capabilities.canCreateTask).toBe(false);
  });

  it("keys every task by its own id, not only by source message, for a 'created' activity row to find its card", () => {
    const detail = toTeamConversationDetailView(
      {
        conversation_id: CONVERSATION,
        other_member: null,
        messages: [],
        tasks: [
          {
            id: "t1",
            conversation_id: CONVERSATION,
            source_message_id: null,
            title: "Composer task",
            description: null,
            status: "todo",
            priority: "normal",
            due_at: null,
            completed_at: null,
            created_at: "2026-08-28T09:00:00.000Z",
            updated_at: "2026-08-28T09:00:00.000Z",
            assigned_to_profile_id: ME,
            assigned_to_name: "Ben Member",
            created_by_profile_id: ME,
            created_by_name: "Ben Member",
          },
        ],
      },
      ME,
    );
    expect(detail.tasksById.get("t1")?.title).toBe("Composer task");
    expect(detail.tasksBySourceMessage.has("t1")).toBe(false);
  });

  it("treats a Slow Mode cooldown in the past as already cleared, and a future one as active", () => {
    const now = new Date("2026-08-28T09:00:00.000Z");
    const cleared = toTeamConversationDetailView(
      {
        conversation_id: CONVERSATION,
        other_member: null,
        messages: [],
        tasks: [],
        my_next_allowed_send_at: "2026-08-28T08:59:00.000Z",
      },
      ME,
      now,
    );
    expect(cleared.myNextAllowedSendAt).toBeNull();

    const active = toTeamConversationDetailView(
      {
        conversation_id: CONVERSATION,
        other_member: null,
        messages: [],
        tasks: [],
        my_next_allowed_send_at: "2026-08-28T09:00:05.000Z",
      },
      ME,
      now,
    );
    expect(active.myNextAllowedSendAt).toBe("2026-08-28T09:00:05.000Z");
  });
});

describe("input contracts: governance", () => {
  it("requires at least one capability when granting a delegated admin", () => {
    expect(
      grantTeamConversationAdminSchema.safeParse({
        conversationId: CONVERSATION,
        targetProfileId: ME,
        capabilities: {},
      }).success,
    ).toBe(false);

    expect(
      grantTeamConversationAdminSchema.safeParse({
        conversationId: CONVERSATION,
        targetProfileId: ME,
        capabilities: { manage_members: true },
      }).success,
    ).toBe(true);
  });

  it("mirrors the database CHECK bound on Slow Mode seconds (1 to 24 hours, or off)", () => {
    expect(
      setTeamConversationSlowModeSchema.safeParse({
        conversationId: CONVERSATION,
        seconds: null,
        scope: "members_and_admins",
      }).success,
    ).toBe(true);
    expect(
      setTeamConversationSlowModeSchema.safeParse({
        conversationId: CONVERSATION,
        seconds: 0,
        scope: "members_and_admins",
      }).success,
    ).toBe(false);
    expect(
      setTeamConversationSlowModeSchema.safeParse({
        conversationId: CONVERSATION,
        seconds: teamSlowModeMaxSeconds,
        scope: "members_and_admins",
      }).success,
    ).toBe(true);
    expect(
      setTeamConversationSlowModeSchema.safeParse({
        conversationId: CONVERSATION,
        seconds: teamSlowModeMaxSeconds + 1,
        scope: "members_and_admins",
      }).success,
    ).toBe(false);
  });
});
