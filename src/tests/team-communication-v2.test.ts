import { describe, expect, it } from "vitest";
import { canonicalGreetingName } from "../domain/profile/greeting";
import {
  groupTeamMessages,
  stillPendingTeamMessages,
  teamActivityLabel,
  teamTypingLabel,
  toTeamConversationDetailView,
  toTeamConversationView,
  toTeamMemberViews,
  toTeamMessageView,
} from "../domain/team/projections";
import type {
  TeamConversationDetailRow,
  TeamConversationRow,
  TeamMessageRow,
} from "../domain/team/schema";

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";

function message(
  overrides: Partial<TeamMessageRow> & { id: string },
): TeamMessageRow {
  return {
    request_id: `req-${overrides.id}`,
    conversation_id: CONVERSATION,
    author_profile_id: THEM,
    author_name: "Lord Anthony Paghubasan",
    author_avatar_url: null,
    body: "Morning.",
    message_type: "text",
    task_id: null,
    task_action: null,
    created_at: "2026-08-26T09:00:00.000Z",
    ...overrides,
  };
}

/**
 * Team Communication V2, at the layer where the browser is actually
 * responsible for something.
 *
 * Nothing here is a security boundary — group membership, typing membership and
 * task authorization all live in 046_team_communication_v2.test.sql. These
 * cover the decisions the projections make on their own.
 */
describe("Dynamic greeting", () => {
  it("uses the given name, so the dashboard is never hardcoded to one person", () => {
    expect(canonicalGreetingName("William Jones")).toBe("William");
  });

  it("keeps a personal title with the name that follows it", () => {
    expect(canonicalGreetingName("Lord Anthony Paghubasan")).toBe(
      "Lord Anthony",
    );
    expect(canonicalGreetingName("Lady Margaret Hale")).toBe("Lady Margaret");
  });

  it("returns nothing rather than guessing when there is no display name", () => {
    expect(canonicalGreetingName(null)).toBeNull();
    expect(canonicalGreetingName("   ")).toBeNull();
  });

  it("does not mistake a lone title for a name", () => {
    expect(canonicalGreetingName("Lord")).toBe("Lord");
  });
});

describe("Optimistic send reconciliation", () => {
  const pending = toTeamMessageView(
    message({ id: "pending-a", request_id: "req-a", author_profile_id: ME }),
    ME,
  );

  it("retires a bubble once the server echoes its request id", () => {
    const confirmed = [
      toTeamMessageView(
        message({ id: "server-1", request_id: "req-a", author_profile_id: ME }),
        ME,
      ),
    ];
    expect(stillPendingTeamMessages([pending], confirmed)).toHaveLength(0);
  });

  it("keeps two identical drafts as two messages", () => {
    /*
     * The reason matching is on the request id and not on body+author: sending
     * "ok" twice is ordinary, and a body match would swallow the second bubble
     * the moment the first was confirmed.
     */
    const second = toTeamMessageView(
      message({ id: "pending-b", request_id: "req-b", author_profile_id: ME }),
      ME,
    );
    const confirmed = [
      toTeamMessageView(
        message({ id: "server-1", request_id: "req-a", author_profile_id: ME }),
        ME,
      ),
    ];

    const remaining = stillPendingTeamMessages([pending, second], confirmed);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.requestId).toBe("req-b");
  });

  it("never retires a failed bubble, which is waiting for the viewer", () => {
    const failed = { ...pending, pending: false, failed: true };
    const confirmed = [
      toTeamMessageView(
        message({ id: "server-1", request_id: "req-a", author_profile_id: ME }),
        ME,
      ),
    ];
    expect(stillPendingTeamMessages([failed], confirmed)).toHaveLength(1);
  });
});

describe("Task activity events", () => {
  const completion = toTeamMessageView(
    message({
      id: "activity-1",
      body: "Ship the audit",
      message_type: "task_activity",
      task_id: "44444444-4444-4444-8444-444444444444",
      task_action: "completed",
    }),
    ME,
  );

  it("reads as a sentence built from the stored title and verb", () => {
    expect(teamActivityLabel(completion)).toBe(
      'Lord Anthony Paghubasan completed "Ship the audit"',
    );
  });

  it("distinguishes a reopening from a completion", () => {
    expect(
      teamActivityLabel({ ...completion, taskAction: "reopened" }),
    ).toContain("reopened");
  });

  it("never merges into a neighbouring run of ordinary messages", () => {
    /*
     * An activity event is not something anybody typed, so it must not inherit
     * the previous author's avatar and name by being folded into their group.
     */
    const groups = groupTeamMessages([
      toTeamMessageView(message({ id: "m1" }), ME),
      completion,
      toTeamMessageView(message({ id: "m2" }), ME),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[1]!.messages[0]!.messageType).toBe("task_activity");
  });
});

describe("Typing", () => {
  const members = toTeamMemberViews([
    { profile_id: THEM, display_name: "Lord Anthony", avatar_url: null },
    { profile_id: ME, display_name: "William Jones", avatar_url: null },
    { profile_id: "x", display_name: "Ida Staff", avatar_url: null },
  ]);

  it("says nothing when nobody is typing", () => {
    expect(teamTypingLabel([])).toBeNull();
  });

  it("names the single typer", () => {
    expect(teamTypingLabel(members.slice(0, 1))).toBe(
      "Lord Anthony is typing…",
    );
  });

  it("names both when a pair is typing", () => {
    expect(teamTypingLabel(members.slice(0, 2))).toBe(
      "Lord Anthony and William Jones are typing…",
    );
  });

  it("caps the sentence in a busy group rather than listing everyone", () => {
    expect(teamTypingLabel(members)).toBe(
      "Lord Anthony and 2 others are typing…",
    );
  });
});

describe("Group conversations", () => {
  function conversation(
    overrides: Partial<TeamConversationRow> = {},
  ): TeamConversationRow {
    return {
      conversation_id: CONVERSATION,
      conversation_kind: "group",
      conversation_title: "SEO Pod",
      member_count: 4,
      other_member_profile_id: null,
      other_member_name: null,
      other_member_avatar_url: null,
      last_message_preview: "Kickoff at ten.",
      last_message_at: "2026-08-26T09:00:00.000Z",
      unread_count: 2,
      my_last_read_at: null,
      ...overrides,
    };
  }

  it("identifies a group by its title, not by a member it does not have", () => {
    const view = toTeamConversationView(conversation());
    expect(view.kind).toBe("group");
    expect(view.name).toBe("SEO Pod");
    expect(view.otherMember).toBeNull();
    expect(view.memberCount).toBe(4);
  });

  it("still names the other person in a direct thread", () => {
    const view = toTeamConversationView(
      conversation({
        conversation_kind: "direct",
        conversation_title: null,
        other_member_profile_id: THEM,
        other_member_name: "Lord Anthony Paghubasan",
        member_count: 2,
      }),
    );
    expect(view.kind).toBe("direct");
    expect(view.name).toBe("Lord Anthony Paghubasan");
    expect(view.otherMember?.profileId).toBe(THEM);
  });

  it("falls back to a name rather than rendering an untitled group", () => {
    expect(
      toTeamConversationView(conversation({ conversation_title: "  " })).name,
    ).toBe("Team group");
  });

  it("carries members and typing through the conversation detail", () => {
    const row: TeamConversationDetailRow = {
      conversation_id: CONVERSATION,
      conversation_kind: "group",
      conversation_title: "SEO Pod",
      members: [
        { profile_id: ME, display_name: "William Jones", avatar_url: null },
        { profile_id: THEM, display_name: "Lord Anthony", avatar_url: null },
      ],
      other_member: null,
      messages: [message({ id: "m1" })],
      tasks: [],
      typing: [
        {
          profile_id: THEM,
          display_name: "Lord Anthony",
          avatar_url: null,
          last_typed_at: "2026-08-26T09:00:01.000Z",
        },
      ],
    };

    const detail = toTeamConversationDetailView(row, ME);
    expect(detail.kind).toBe("group");
    expect(detail.name).toBe("SEO Pod");
    expect(detail.members).toHaveLength(2);
    expect(detail.typingMembers).toHaveLength(1);
    expect(teamTypingLabel(detail.typingMembers)).toBe(
      "Lord Anthony is typing…",
    );
  });

  it("treats a payload with no V2 fields as a direct conversation", () => {
    /*
     * The read models were extended in place, so a response that predates the
     * V2 columns must still render rather than throwing on a missing kind.
     */
    const detail = toTeamConversationDetailView(
      {
        conversation_id: CONVERSATION,
        other_member: {
          profile_id: THEM,
          display_name: "Lord Anthony",
          avatar_url: null,
        },
        messages: [],
        tasks: [],
      },
      ME,
    );
    expect(detail.kind).toBe("direct");
    expect(detail.typingMembers).toEqual([]);
    expect(detail.members).toEqual([]);
  });
});
