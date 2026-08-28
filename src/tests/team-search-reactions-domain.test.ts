import { describe, expect, it } from "vitest";
import {
  parseTeamHighlightedSnippet,
  type TeamSnippetSegment,
} from "../domain/team/formatting";
import {
  applyOptimisticTeamReactionToggle,
  formatTeamSearchResultDate,
  mergeTeamMessageViews,
  toTeamMessageView,
  toTeamReactionViews,
  toTeamSearchResultView,
  toTeamSearchResultViews,
  unnamedTeamMember,
  type TeamMessageView,
} from "../domain/team/projections";
import {
  searchTeamConversationMessagesSchema,
  teamReactionCodeSchema,
  teamSearchQueryMaxLength,
  type TeamMessageReactionRow,
  type TeamSearchResultRow,
} from "../domain/team/schema";

/**
 * Team Communication V2.3 domain — search snippet parsing, reaction
 * aggregation, and the optimistic reaction toggle.
 *
 * Authorization, the search RPC and the reaction toggle RPC are proved by
 * 049_team_search_and_reactions.test.sql. Everything here is the pure half:
 * total functions of their input, no fetching, no auth.
 */

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";

function baseMessage(overrides: Partial<TeamMessageView> = {}): TeamMessageView {
  return {
    id: "msg-1",
    requestId: null,
    conversationId: CONVERSATION,
    authorProfileId: THEM,
    authorName: "Anthony Paghubasan",
    authorAvatarUrl: null,
    authorInitials: "AP",
    body: "Hello",
    messageType: "text",
    taskId: null,
    taskAction: null,
    createdAt: "2026-08-26T09:00:00.000Z",
    isMine: false,
    reactions: [],
    replyToMessageId: null,
    replyQuoteText: null,
    replySourceAuthorName: null,
    replySourceDeleted: false,
    forwardedFromMessageId: null,
    forwardedFromAuthorName: null,
    deletedForEveryone: false,
    ...overrides,
  };
}

function reactionRow(overrides: Partial<TeamMessageReactionRow> = {}): TeamMessageReactionRow {
  return {
    reaction_code: "heart",
    reaction_count: 1,
    reacted_by_me: false,
    reactor_names: ["Anthony Paghubasan"],
    ...overrides,
  };
}

describe("parseTeamHighlightedSnippet", () => {
  const SENTINEL_START = "";
  const SENTINEL_STOP = "";

  it("returns the whole string unmatched when there is no sentinel pair", () => {
    const segments = parseTeamHighlightedSnippet("no markers here");
    expect(segments).toEqual<TeamSnippetSegment[]>([{ text: "no markers here", matched: false }]);
  });

  it("splits a single match into three segments", () => {
    const snippet = `I already sent the ${SENTINEL_START}website${SENTINEL_STOP} audit to the client`;
    expect(parseTeamHighlightedSnippet(snippet)).toEqual<TeamSnippetSegment[]>([
      { text: "I already sent the ", matched: false },
      { text: "website", matched: true },
      { text: " audit to the client", matched: false },
    ]);
  });

  it("handles multiple matches in one snippet", () => {
    const snippet = `${SENTINEL_START}website${SENTINEL_STOP} needs another ${SENTINEL_START}website${SENTINEL_STOP} page`;
    expect(parseTeamHighlightedSnippet(snippet)).toEqual<TeamSnippetSegment[]>([
      { text: "website", matched: true },
      { text: " needs another ", matched: false },
      { text: "website", matched: true },
      { text: " page", matched: false },
    ]);
  });

  it("tolerates an unterminated start marker by treating the rest as matched", () => {
    const snippet = `plain ${SENTINEL_START}unterminated`;
    expect(parseTeamHighlightedSnippet(snippet)).toEqual<TeamSnippetSegment[]>([
      { text: "plain ", matched: false },
      { text: "unterminated", matched: true },
    ]);
  });

  it("drops empty segments rather than emitting blank text nodes", () => {
    const snippet = `${SENTINEL_START}only${SENTINEL_STOP}`;
    expect(parseTeamHighlightedSnippet(snippet)).toEqual<TeamSnippetSegment[]>([
      { text: "only", matched: true },
    ]);
  });
});

describe("toTeamReactionViews", () => {
  it("maps a reaction row to its emoji and reactor list", () => {
    const views = toTeamReactionViews([
      reactionRow({ reaction_code: "like", reaction_count: 2, reacted_by_me: true, reactor_names: ["A", "B"] }),
    ]);
    expect(views).toEqual([
      { code: "like", emoji: "\u{1F44D}", count: 2, reactedByMe: true, reactorNames: ["A", "B"] },
    ]);
  });

  it("never renders a zero-count reaction", () => {
    expect(toTeamReactionViews([reactionRow({ reaction_count: 0 })])).toEqual([]);
  });

  it("drops a reaction code the client no longer recognizes rather than crashing", () => {
    expect(toTeamReactionViews([reactionRow({ reaction_code: "shrug" })])).toEqual([]);
  });

  it("falls back to the unnamed placeholder for a reactor with no display name", () => {
    const [view] = toTeamReactionViews([reactionRow({ reactor_names: [null] })]);
    expect(view?.reactorNames).toEqual([unnamedTeamMember]);
  });

  it("sorts quick-action codes before picker codes, matching the rail's own order", () => {
    const views = toTeamReactionViews([
      reactionRow({ reaction_code: "fire" }),
      reactionRow({ reaction_code: "heart" }),
      reactionRow({ reaction_code: "like" }),
    ]);
    expect(views.map((view) => view.code)).toEqual(["like", "heart", "fire"]);
  });

  it("is undefined-safe: no reactions field on the row produces an empty list", () => {
    expect(toTeamReactionViews(undefined)).toEqual([]);
  });
});

describe("toTeamMessageView reactions", () => {
  it("carries the mapped reaction views onto the message", () => {
    const view = toTeamMessageView(
      {
        id: "m1",
        conversation_id: CONVERSATION,
        author_profile_id: THEM,
        author_name: "Anthony",
        author_avatar_url: null,
        body: "hi",
        created_at: "2026-08-26T09:00:00.000Z",
        reactions: [reactionRow({ reaction_code: "check", reaction_count: 3 })],
      },
      ME,
    );
    expect(view.reactions).toEqual([
      { code: "check", emoji: "\u{2705}", count: 3, reactedByMe: false, reactorNames: ["Anthony Paghubasan"] },
    ]);
  });
});

describe("applyOptimisticTeamReactionToggle", () => {
  it("adds a brand-new reaction with the actor as its first reactor", () => {
    const next = applyOptimisticTeamReactionToggle(baseMessage(), "like", "Anthony");
    expect(next.reactions).toEqual([
      { code: "like", emoji: "\u{1F44D}", count: 1, reactedByMe: true, reactorNames: ["Anthony"] },
    ]);
  });

  it("increments an existing aggregate the actor had not yet joined", () => {
    const message = baseMessage({
      reactions: [{ code: "heart", emoji: "\u{2764}\u{FE0F}", count: 1, reactedByMe: false, reactorNames: ["Blair"] }],
    });
    const next = applyOptimisticTeamReactionToggle(message, "heart", "Anthony");
    expect(next.reactions).toEqual([
      { code: "heart", emoji: "\u{2764}\u{FE0F}", count: 2, reactedByMe: true, reactorNames: ["Blair", "Anthony"] },
    ]);
  });

  it("toggling an already-applied reaction off decrements the count and drops the actor's name", () => {
    const message = baseMessage({
      reactions: [{ code: "heart", emoji: "\u{2764}\u{FE0F}", count: 2, reactedByMe: true, reactorNames: ["Blair", "Anthony"] }],
    });
    const next = applyOptimisticTeamReactionToggle(message, "heart", "Anthony");
    expect(next.reactions).toEqual([
      { code: "heart", emoji: "\u{2764}\u{FE0F}", count: 1, reactedByMe: false, reactorNames: ["Blair"] },
    ]);
  });

  it("drops the chip entirely once the last reactor toggles off, never showing count 0", () => {
    const message = baseMessage({
      reactions: [{ code: "heart", emoji: "\u{2764}\u{FE0F}", count: 1, reactedByMe: true, reactorNames: ["Anthony"] }],
    });
    const next = applyOptimisticTeamReactionToggle(message, "heart", "Anthony");
    expect(next.reactions).toEqual([]);
  });

  it("leaves other reaction types on the same message untouched", () => {
    const message = baseMessage({
      reactions: [
        { code: "like", emoji: "\u{1F44D}", count: 1, reactedByMe: true, reactorNames: ["Anthony"] },
        { code: "fire", emoji: "\u{1F525}", count: 2, reactedByMe: false, reactorNames: ["Blair", "Casey"] },
      ],
    });
    const next = applyOptimisticTeamReactionToggle(message, "like", "Anthony");
    const fire = next.reactions.find((reaction) => reaction.code === "fire");
    expect(fire).toEqual({ code: "fire", emoji: "\u{1F525}", count: 2, reactedByMe: false, reactorNames: ["Blair", "Casey"] });
  });

  it("falls back to the unnamed placeholder when the actor has no display name", () => {
    const next = applyOptimisticTeamReactionToggle(baseMessage(), "wow", null);
    expect(next.reactions[0]?.reactorNames).toEqual([unnamedTeamMember]);
  });

  it("does not mutate the original message view", () => {
    const message = baseMessage();
    const originalReactions = message.reactions;
    applyOptimisticTeamReactionToggle(message, "like", "Anthony");
    expect(message.reactions).toBe(originalReactions);
  });
});

describe("mergeTeamMessageViews", () => {
  it("returns the existing array unchanged when there is nothing incoming", () => {
    const existing = [baseMessage({ id: "a" })];
    expect(mergeTeamMessageViews(existing, [])).toBe(existing);
  });

  it("de-duplicates by id, preferring the incoming copy", () => {
    const existing = [baseMessage({ id: "a", body: "old" })];
    const merged = mergeTeamMessageViews(existing, [baseMessage({ id: "a", body: "new" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.body).toBe("new");
  });

  it("sorts the combined set by (createdAt, id) ascending", () => {
    const older = baseMessage({ id: "z", createdAt: "2026-08-26T09:00:00.000Z" });
    const newer = baseMessage({ id: "a", createdAt: "2026-08-26T10:00:00.000Z" });
    const merged = mergeTeamMessageViews([newer], [older]);
    expect(merged.map((message) => message.id)).toEqual(["z", "a"]);
  });

  it("breaks a created_at tie by id, matching the database's own keyset order", () => {
    const same = "2026-08-26T09:00:00.000Z";
    const merged = mergeTeamMessageViews(
      [baseMessage({ id: "b", createdAt: same })],
      [baseMessage({ id: "a", createdAt: same })],
    );
    expect(merged.map((message) => message.id)).toEqual(["a", "b"]);
  });
});

describe("search result projection", () => {
  function searchRow(overrides: Partial<TeamSearchResultRow> = {}): TeamSearchResultRow {
    return {
      id: "msg-1",
      author_profile_id: THEM,
      author_name: "William Jones",
      author_avatar_url: null,
      created_at: "2026-08-12T15:00:00.000Z",
      snippet: "…I already sent the website audit to the client…",
      ...overrides,
    };
  }

  it("formats the result date with a full year, since a search result reads as history", () => {
    expect(formatTeamSearchResultDate("2026-08-12T15:00:00.000Z")).toBe("Aug 12, 2026");
  });

  it("builds highlighted segments and a resolved author from the row", () => {
    const view = toTeamSearchResultView(searchRow());
    expect(view.authorName).toBe("William Jones");
    expect(view.dateLabel).toBe("Aug 12, 2026");
    expect(view.segments.some((segment) => segment.matched && segment.text === "website")).toBe(true);
  });

  it("falls back to the unnamed placeholder for a result with no author name", () => {
    const view = toTeamSearchResultView(searchRow({ author_name: null }));
    expect(view.authorName).toBe(unnamedTeamMember);
  });

  it("maps a whole result list in order", () => {
    const views = toTeamSearchResultViews([searchRow({ id: "1" }), searchRow({ id: "2" })]);
    expect(views.map((view) => view.id)).toEqual(["1", "2"]);
  });
});

describe("schema", () => {
  it("accepts only the nine allowed reaction codes", () => {
    expect(teamReactionCodeSchema.safeParse("heart").success).toBe(true);
    expect(teamReactionCodeSchema.safeParse("shrug").success).toBe(false);
    expect(teamReactionCodeSchema.safeParse("").success).toBe(false);
  });

  it("caps a search query at the documented maximum length", () => {
    const tooLong = "a".repeat(teamSearchQueryMaxLength + 1);
    const result = searchTeamConversationMessagesSchema.safeParse({
      conversationId: CONVERSATION,
      query: tooLong,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blank query rather than forwarding it to the database", () => {
    const result = searchTeamConversationMessagesSchema.safeParse({
      conversationId: CONVERSATION,
      query: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a normal query within bounds", () => {
    const result = searchTeamConversationMessagesSchema.safeParse({
      conversationId: CONVERSATION,
      query: "website",
    });
    expect(result.success).toBe(true);
  });
});
