import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  toSupervisedConversationPage,
  toSupervisedMessage,
  toSupervisedMessageSearchPage,
  toSupervisedMessageWindow,
  toSupervisedTranscriptPage,
} from "../domain/team-supervision/projections";
import type {
  SupervisedConversationListRow,
  SupervisedMessageRow,
  SupervisedSearchResponseRow,
  SupervisedTranscriptPageRow,
} from "../domain/team-supervision/schema";
import { NotFoundError, ValidationError } from "../lib/errors/application-error";
import type { TrustedServerClient } from "../lib/supabase/trusted-server-client";
import { TeamSupervisionRepository } from "../repositories/team-supervision-repository";
import type { UserMutationClient } from "../repositories/types";
import { TeamSupervisionService } from "../services/team-supervision-service";

const conversationId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const ownerId = "33333333-3333-4333-8333-333333333333";
const staffId = "44444444-4444-4444-8444-444444444444";
const correlationId = "0123456789abcdef0123456789abcdef";
const secretQuery = "confidential payroll needle";
const secretBody = "private body the supervisor reads";

/** Records every rpc call; any table access fails the test. */
function fakeClient(response: { data: unknown; error: unknown }) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = {
    rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return Promise.resolve(response);
    },
    from(table: string) {
      throw new Error(`direct table access: ${table}`);
    },
  } as unknown as UserMutationClient;
  return { client, calls };
}

function service(response: { data: unknown; error: unknown }) {
  const fake = fakeClient(response);
  return {
    ...fake,
    service: new TeamSupervisionService({
      repository: new TeamSupervisionRepository(fake.client),
    }),
  };
}

const listRow: SupervisedConversationListRow = {
  conversation_id: conversationId,
  conversation_kind: "direct",
  created_at: "2026-09-01T00:00:00+00:00",
  last_message_at: "2026-09-02T00:00:00+00:00",
  participant_one_profile_id: ownerId,
  participant_one_name: "Owner",
  participant_one_avatar_url: null,
  participant_one_archived: false,
  participant_two_profile_id: staffId,
  participant_two_name: "Former Staff",
  participant_two_avatar_url: "avatars/staff.png",
  participant_two_archived: true,
};

function messageRow(overrides: Partial<SupervisedMessageRow> = {}): SupervisedMessageRow {
  return {
    message_id: messageId,
    author_profile_id: staffId,
    author_name: "Staff",
    author_avatar_url: null,
    author_archived: false,
    body: secretBody,
    message_type: "text",
    created_at: "2026-09-02T00:00:00+00:00",
    reply: null,
    forwarded: false,
    forwarded_from_author_name: null,
    deleted_for_everyone: false,
    deleted_for_everyone_at: null,
    deleted_by_profile_id: null,
    deleted_by_name: null,
    supervisory_notice: null,
    reactions: [],
    ...overrides,
  };
}

const pageRow: SupervisedTranscriptPageRow = {
  conversation_id: conversationId,
  conversation_kind: "direct",
  created_at: "2026-09-01T00:00:00+00:00",
  last_message_at: "2026-09-02T00:00:00+00:00",
  participants: [
    { profile_id: ownerId, display_name: "Owner", avatar_url: null, archived: false },
    { profile_id: staffId, display_name: "Staff", avatar_url: null, archived: true },
  ],
  messages: [messageRow()],
  has_more: true,
  next_before_created_at: "2026-09-02T00:00:00+00:00",
  next_before_message_id: messageId,
};

const searchRow: SupervisedSearchResponseRow = {
  results: [
    {
      id: messageId,
      author_profile_id: staffId,
      author_name: "Staff",
      author_avatar_url: null,
      created_at: "2026-09-02T00:00:00+00:00",
      snippet: "the needle here",
    },
  ],
  has_more: false,
  next_before_created_at: null,
  next_before_message_id: null,
};

/** Every key anywhere in a mapped object, lower-cased. */
function allKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => allKeys(item, keys));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key.toLowerCase());
      allKeys(child, keys);
    }
  }
  return keys;
}

const excludedKeyFragments = [
  "unread",
  "lastread",
  "last_read",
  "deliver",
  "notification",
  "presence",
  "online",
  "typing",
  "capabilit",
  "permission",
  "reactedbyme",
  "reacted_by_me",
  "hidden",
  "storage",
  "signed",
  "playback",
  "bucket",
  "path",
  "duration",
  "ticket",
  "source",
  "original",
  "query",
];

function expectNoExcludedKeys(value: unknown) {
  for (const key of allKeys(value)) {
    for (const fragment of excludedKeyFragments) {
      expect(key, `${key} contains ${fragment}`).not.toContain(fragment);
    }
  }
}

afterEach(() => vi.restoreAllMocks());

describe("TeamSupervisionRepository RPC wiring", () => {
  it("list calls only app_list_team_supervised_conversations with the keyset", async () => {
    const { service: supervision, calls } = service({ data: [listRow], error: null });
    await supervision.listConversations({
      limit: 1,
      beforeLastMessageAt: "2026-09-03T00:00:00+00:00",
      beforeConversationId: conversationId,
    });
    expect(calls).toEqual([
      {
        name: "app_list_team_supervised_conversations",
        args: {
          p_limit: 1,
          p_before_last_message_at: "2026-09-03T00:00:00+00:00",
          p_before_conversation_id: conversationId,
        },
      },
    ]);
  });

  it("list with no input lets the database own the defaults", async () => {
    const { service: supervision, calls } = service({ data: [], error: null });
    await supervision.listConversations();
    expect(calls).toEqual([
      {
        name: "app_list_team_supervised_conversations",
        args: {
          p_limit: undefined,
          p_before_last_message_at: undefined,
          p_before_conversation_id: undefined,
        },
      },
    ]);
  });

  it("detail calls only app_get_team_supervised_conversation", async () => {
    const { service: supervision, calls } = service({ data: pageRow, error: null });
    await supervision.getConversation({ conversationId, limit: 25, correlationId });
    expect(calls).toEqual([
      {
        name: "app_get_team_supervised_conversation",
        args: { p_conversation_id: conversationId, p_limit: 25, p_correlation_id: correlationId },
      },
    ]);
  });

  it("history calls only app_list_team_supervised_messages_before with the strict cursor", async () => {
    const { service: supervision, calls } = service({ data: pageRow, error: null });
    await supervision.listMessagesBefore({
      conversationId,
      beforeCreatedAt: "2026-09-02T00:00:00+00:00",
      beforeMessageId: messageId,
    });
    expect(calls).toEqual([
      {
        name: "app_list_team_supervised_messages_before",
        args: {
          p_conversation_id: conversationId,
          p_before_created_at: "2026-09-02T00:00:00+00:00",
          p_before_message_id: messageId,
          p_limit: undefined,
          p_correlation_id: undefined,
        },
      },
    ]);
  });

  it("window calls only app_get_team_supervised_message_window", async () => {
    const { service: supervision, calls } = service({
      data: { found: false, messages: [] },
      error: null,
    });
    await supervision.getMessageWindow({
      conversationId,
      targetMessageId: messageId,
      beforeLimit: 0,
      afterLimit: 100,
    });
    expect(calls).toEqual([
      {
        name: "app_get_team_supervised_message_window",
        args: {
          p_conversation_id: conversationId,
          p_target_message_id: messageId,
          p_before_limit: 0,
          p_after_limit: 100,
          p_correlation_id: undefined,
        },
      },
    ]);
  });

  it("search calls only app_search_team_supervised_conversation_messages for one conversation", async () => {
    const { service: supervision, calls } = service({ data: searchRow, error: null });
    await supervision.searchConversation({ conversationId, query: secretQuery, limit: 50 });
    expect(calls).toEqual([
      {
        name: "app_search_team_supervised_conversation_messages",
        args: {
          p_conversation_id: conversationId,
          p_query: secretQuery,
          p_before_created_at: undefined,
          p_before_message_id: undefined,
          p_limit: 50,
          p_correlation_id: undefined,
        },
      },
    ]);
  });

  it("accepts only the user-scoped client, never the trusted server client", () => {
    const trusted = null as unknown as TrustedServerClient;
    // @ts-expect-error A trusted/service-role client must not type-check here.
    expect(() => new TeamSupervisionRepository(trusted)).not.toThrow();
  });

  it("source is server-only, RPC-only, and names exactly the five supervisory RPCs", () => {
    const repository = readFileSync("src/repositories/team-supervision-repository.ts", "utf8");
    const supervisionService = readFileSync("src/services/team-supervision-service.ts", "utf8");

    for (const source of [repository, supervisionService]) {
      expect(source).toMatch(/^import "server-only";/m);
      expect(source).not.toMatch(/\.from\(/);
      expect(source).not.toMatch(/trusted-server-client|TrustedServerClient|SECRET_KEY|auth-admin/);
      expect(source).not.toMatch(/console\./);
    }

    const rpcNames = [...repository.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((match) => match[1]);
    expect(rpcNames.sort()).toEqual([
      "app_get_team_supervised_conversation",
      "app_get_team_supervised_message_window",
      "app_list_team_supervised_conversations",
      "app_list_team_supervised_messages_before",
      "app_search_team_supervised_conversation_messages",
    ]);
  });

  it("exposes only the five read methods — no playback, global, group or mutation method", () => {
    const methods = (prototype: object) =>
      Object.getOwnPropertyNames(prototype)
        .filter((name) => name !== "constructor")
        .sort();
    const expected = [
      "getConversation",
      "getMessageWindow",
      "listConversations",
      "listMessagesBefore",
      "searchConversation",
    ];
    expect(methods(TeamSupervisionRepository.prototype)).toEqual(expected);
    expect(methods(TeamSupervisionService.prototype)).toEqual(expected);
  });
});

describe("TeamSupervisionService input bounds", () => {
  it.each([
    ["list over 100", "listConversations", { limit: 101 }],
    ["list timestamp without id", "listConversations", { beforeLastMessageAt: "2026-09-01T00:00:00Z" }],
    ["detail over 100", "getConversation", { conversationId, limit: 101 }],
    ["detail bad correlation", "getConversation", { conversationId, correlationId: "ABC" }],
    ["history without cursor", "listMessagesBefore", { conversationId }],
    ["window side over 100", "getMessageWindow", { conversationId, targetMessageId: messageId, afterLimit: 101 }],
    ["search over 50", "searchConversation", { conversationId, query: "x", limit: 51 }],
    ["search half cursor", "searchConversation", { conversationId, query: "x", beforeMessageId: messageId }],
    ["search blank query", "searchConversation", { conversationId, query: "   " }],
    ["search no conversation", "searchConversation", { query: "x" }],
  ] as const)("rejects %s before any RPC", async (_label, method, input) => {
    const { service: supervision, calls } = service({ data: null, error: null });
    await expect(
      (supervision[method] as (value: unknown) => Promise<unknown>)(input),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toEqual([]);
  });
});

describe("Team supervision domain mapping", () => {
  it("maps a list page with archived identity and a keyset only when the page is full", () => {
    const full = toSupervisedConversationPage([listRow], 1);
    expect(full.conversations[0]).toEqual({
      conversationId,
      kind: "direct",
      createdAt: "2026-09-01T00:00:00+00:00",
      lastMessageAt: "2026-09-02T00:00:00+00:00",
      participants: [
        { profileId: ownerId, displayName: "Owner", avatarUrl: null, archived: false },
        { profileId: staffId, displayName: "Former Staff", avatarUrl: "avatars/staff.png", archived: true },
      ],
    });
    expect(full.nextCursor).toEqual({
      beforeLastMessageAt: "2026-09-02T00:00:00+00:00",
      beforeConversationId: conversationId,
    });
    expect(toSupervisedConversationPage([listRow], 50).nextCursor).toBeNull();
    expectNoExcludedKeys(full);
  });

  it("maps a transcript page with canonical body, author and cursor", () => {
    const page = toSupervisedTranscriptPage(pageRow);
    expect(page.participants[1]).toEqual({
      profileId: staffId,
      displayName: "Staff",
      avatarUrl: null,
      archived: true,
    });
    expect(page.messages[0]).toMatchObject({
      messageId,
      body: secretBody,
      messageType: "text",
      author: { profileId: staffId, displayName: "Staff", archived: false },
      deletion: null,
      supervisoryNotice: null,
    });
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual({
      beforeCreatedAt: "2026-09-02T00:00:00+00:00",
      beforeMessageId: messageId,
    });
    expect(toSupervisedTranscriptPage({ ...pageRow, has_more: false, next_before_created_at: null, next_before_message_id: null }).nextCursor).toBeNull();
    expectNoExcludedKeys(page);
  });

  it("preserves reply, forward and aggregate reaction display metadata", () => {
    const message = toSupervisedMessage(
      messageRow({
        reply: {
          message_id: "55555555-5555-4555-8555-555555555555",
          author_profile_id: ownerId,
          author_name: "Owner",
          author_avatar_url: null,
          body: "Message deleted",
          message_type: "text",
          deleted_for_everyone: true,
        },
        forwarded: true,
        forwarded_from_author_name: "Someone",
        reactions: [{ reaction_code: "thumbs_up", reaction_count: 2 }],
      }),
    );
    expect(message.reply).toEqual({
      messageId: "55555555-5555-4555-8555-555555555555",
      authorProfileId: ownerId,
      authorName: "Owner",
      authorAvatarUrl: null,
      body: "Message deleted",
      messageType: "text",
      deletedForEveryone: true,
    });
    expect(message.forwarded).toBe(true);
    expect(message.forwardedFromAuthorName).toBe("Someone");
    expect(message.reactions).toEqual([{ reactionCode: "thumbs_up", count: 2 }]);
    expectNoExcludedKeys(message);
  });

  it("keeps the deletion tombstone as returned and reconstructs nothing", () => {
    const message = toSupervisedMessage(
      messageRow({
        body: "Message deleted",
        deleted_for_everyone: true,
        deleted_for_everyone_at: "2026-09-03T00:00:00+00:00",
        deleted_by_profile_id: staffId,
        deleted_by_name: "Staff",
      }),
    );
    expect(message.body).toBe("Message deleted");
    expect(message.deletion).toEqual({
      deletedAt: "2026-09-03T00:00:00+00:00",
      deletedByProfileId: staffId,
      deletedByName: "Staff",
    });
    expectNoExcludedKeys(message);
  });

  it("represents voice as unavailable with no storage or playback field", () => {
    const message = toSupervisedMessage(
      messageRow({
        body: "Voice message",
        message_type: "voice",
        supervisory_notice: "Unavailable in supervisory view",
      }),
    );
    expect(message).toMatchObject({
      messageType: "voice",
      body: "Voice message",
      supervisoryNotice: "Unavailable in supervisory view",
    });
    expectNoExcludedKeys(message);
  });

  it("maps a window, and a not-found target to the same bare safe result", () => {
    expect(toSupervisedMessageWindow({ found: false, messages: [] })).toEqual({ found: false });
    const window = toSupervisedMessageWindow({
      found: true,
      conversation_id: conversationId,
      conversation_kind: "direct",
      created_at: pageRow.created_at,
      last_message_at: pageRow.last_message_at,
      participants: pageRow.participants,
      messages: [messageRow()],
      has_more_before: false,
      has_more_after: true,
    });
    expect(window).toMatchObject({ found: true, hasMoreBefore: false, hasMoreAfter: true });
    expectNoExcludedKeys(window);
  });

  it("maps a bounded search snippet and never carries the query", async () => {
    const { service: supervision } = service({ data: searchRow, error: null });
    const page = await supervision.searchConversation({ conversationId, query: secretQuery });
    expect(page.results[0]).toEqual({
      messageId,
      author: { profileId: staffId, displayName: "Staff", avatarUrl: null },
      createdAt: "2026-09-02T00:00:00+00:00",
      snippet: "the needle here",
    });
    expect(page.nextCursor).toBeNull();
    expect(JSON.stringify(page)).not.toContain(secretQuery);
    expect(toSupervisedMessageSearchPage({ ...searchRow, has_more: true, next_before_created_at: "2026-09-02T00:00:00+00:00", next_before_message_id: messageId }).nextCursor).toEqual({
      beforeCreatedAt: "2026-09-02T00:00:00+00:00",
      beforeMessageId: messageId,
    });
    expectNoExcludedKeys(page);
  });
});

describe("Team supervision error safety", () => {
  function spyConsole() {
    return ["log", "info", "warn", "error", "debug"].map((level) =>
      vi.spyOn(console, level as "log").mockImplementation(() => undefined),
    );
  }

  it("keeps the database's single safe not-found and logs nothing", async () => {
    const spies = spyConsole();
    const { service: supervision } = service({
      data: null,
      error: { code: "P0002", message: "team conversation unavailable" },
    });
    const failure = await supervision
      .getConversation({ conversationId })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NotFoundError);
    expect(String((failure as Error).message)).not.toMatch(/group|direct|member/i);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("does not put the search query into the error or any log", async () => {
    const spies = spyConsole();
    const { service: supervision } = service({
      data: null,
      error: { code: "WF429", message: "rate limited" },
    });
    const failure = await supervision
      .searchConversation({ conversationId, query: secretQuery })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(`${String(failure)} ${JSON.stringify(failure)}`).not.toContain(secretQuery);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("does not echo an oversized query in the validation failure", async () => {
    const oversized = `${secretQuery} ${"x".repeat(300)}`;
    const { service: supervision } = service({ data: null, error: null });
    const failure = await supervision
      .searchConversation({ conversationId, query: oversized })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ValidationError);
    const cause = (failure as { cause?: unknown }).cause;
    expect(`${String(failure)} ${JSON.stringify(cause)}`).not.toContain(secretQuery);
  });
});

describe("Team supervision mapping against hostile rows", () => {
  // Fields an RPC must never return. If one ever did (a future migration, a
  // wrong join), the explicit mappers must still drop it rather than spread it.
  const hostile = {
    unread_count: 9,
    last_read_at: "2026-09-02T00:00:00+00:00",
    reacted_by_me: true,
    capabilities: { can_delete: true },
    hidden_for_me: true,
    voice_storage_path: "team-voice/secret.webm",
    signed_url: "https://storage.example/secret?token=x",
    deliveries: [{ profile_id: ownerId }],
    presence: "online",
    source_ticket_id: messageId,
    request_id: correlationId,
    original_body: "reconstructed original",
  };
  const hostileValues = /team-voice|token=x|reconstructed original|online/;

  /** Only JSON primitives, arrays and plain objects; no undefined, Date, Map, class. */
  function expectPlainJson(value: unknown) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
    if (Array.isArray(value)) return value.forEach(expectPlainJson);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    for (const child of Object.values(value as object)) expectPlainJson(child);
  }

  const message = {
    ...messageRow({
      reply: {
        message_id: messageId,
        author_profile_id: ownerId,
        author_name: "Owner",
        author_avatar_url: null,
        body: "quoted",
        message_type: "text",
        deleted_for_everyone: false,
        ...hostile,
      } as SupervisedMessageRow["reply"],
      reactions: [{ reaction_code: "like", reaction_count: 2, ...hostile }],
    }),
    ...hostile,
  } as SupervisedMessageRow;
  const participants = pageRow.participants.map((row) => ({ ...row, ...hostile }));

  it.each([
    ["list", () => toSupervisedConversationPage([{ ...listRow, ...hostile }], 50)],
    ["transcript", () => toSupervisedTranscriptPage({ ...pageRow, participants, messages: [message], ...hostile })],
    [
      "window",
      () =>
        toSupervisedMessageWindow({
          found: true,
          conversation_id: conversationId,
          conversation_kind: "direct",
          created_at: pageRow.created_at,
          last_message_at: pageRow.last_message_at,
          participants,
          messages: [message],
          has_more_before: false,
          has_more_after: false,
          ...hostile,
        }),
    ],
    [
      "search",
      () =>
        toSupervisedMessageSearchPage({
          ...searchRow,
          results: searchRow.results.map((row) => ({ ...row, body: secretBody, ...hostile })),
          ...hostile,
        }),
    ],
  ] as const)("%s drops every unexpected field and stays plain JSON", (_label, map) => {
    const mapped = map();
    expectNoExcludedKeys(mapped);
    expect(allKeys(mapped)).not.toContain("request_id");
    expect(JSON.stringify(mapped)).not.toMatch(hostileValues);
    expectPlainJson(mapped);
    expect(JSON.parse(JSON.stringify(mapped))).toEqual(mapped);
  });

  it("search results carry the snippet, never the full body", () => {
    const page = toSupervisedMessageSearchPage({
      ...searchRow,
      results: searchRow.results.map((row) => ({ ...row, body: secretBody })),
    });
    expect(JSON.stringify(page)).not.toContain(secretBody);
  });
});
