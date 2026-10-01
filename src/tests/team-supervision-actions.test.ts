import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamSupervisionRepository } from "../repositories/team-supervision-repository";
import type { UserMutationClient } from "../repositories/types";
import { TeamSupervisionService } from "../services/team-supervision-service";

const getInternalContext = vi.fn();
const currentCorrelationId = vi.fn();

vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: () => getInternalContext(),
}));
vi.mock("../lib/security/request-correlation", () => ({
  currentCorrelationId: (...args: unknown[]) => currentCorrelationId(...args),
}));

const actions = await import("../app/actions/team-supervision");

const conversationId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const requestCorrelation = "0123456789abcdef0123456789abcdef";
const spoofedCorrelation = "ffffffffffffffffffffffffffffffff";
const secretQuery = "confidential payroll needle";

const pageRow = {
  conversation_id: conversationId,
  conversation_kind: "direct",
  created_at: "2026-09-01T00:00:00+00:00",
  last_message_at: "2026-09-02T00:00:00+00:00",
  participants: [],
  messages: [],
  has_more: false,
  next_before_created_at: null,
  next_before_message_id: null,
};

type RpcResponse = { data: unknown; error: unknown };

/** Real service + repository over a fake user client that records RPCs. */
function wire(response: RpcResponse) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve(response);
    },
    from(table: string) {
      throw new Error(`direct table access: ${table}`);
    },
  } as unknown as UserMutationClient;
  const service = new TeamSupervisionService({
    repository: new TeamSupervisionRepository(client),
  });
  const spies = {
    listConversations: vi.spyOn(service, "listConversations"),
    getConversation: vi.spyOn(service, "getConversation"),
    listMessagesBefore: vi.spyOn(service, "listMessagesBefore"),
    getMessageWindow: vi.spyOn(service, "getMessageWindow"),
    searchConversation: vi.spyOn(service, "searchConversation"),
  };
  getInternalContext.mockResolvedValue({ services: { teamSupervision: service } });
  return { calls, spies };
}

function onlyCalled(spies: Record<string, { mock: { calls: unknown[] } }>, name: string) {
  for (const [method, spy] of Object.entries(spies)) {
    expect(spy.mock.calls.length, method).toBe(method === name ? 1 : 0);
  }
}

beforeEach(() => {
  getInternalContext.mockReset();
  currentCorrelationId.mockReset().mockResolvedValue(requestCorrelation);
});
afterEach(() => vi.restoreAllMocks());

describe("team supervision actions: one service call, one RPC", () => {
  it("list forwards the keyset and no correlation id", async () => {
    const { calls, spies } = wire({ data: [], error: null });
    const result = await actions.listSupervisedConversationsAction({
      limit: 10,
      correlationId: spoofedCorrelation,
    });
    expect(result).toEqual({ ok: true, data: { conversations: [], nextCursor: null } });
    onlyCalled(spies, "listConversations");
    expect(calls).toEqual([
      {
        name: "app_list_team_supervised_conversations",
        args: { p_limit: 10, p_before_last_message_at: undefined, p_before_conversation_id: undefined },
      },
    ]);
    expect(currentCorrelationId).not.toHaveBeenCalled();
  });

  it("detail forwards the trusted request correlation, not the caller's", async () => {
    const { calls, spies } = wire({ data: pageRow, error: null });
    const result = await actions.getSupervisedConversationAction({
      conversationId,
      correlationId: spoofedCorrelation,
    });
    expect(result.ok).toBe(true);
    onlyCalled(spies, "getConversation");
    expect(calls).toEqual([
      {
        name: "app_get_team_supervised_conversation",
        args: { p_conversation_id: conversationId, p_limit: undefined, p_correlation_id: requestCorrelation },
      },
    ]);
  });

  it("history forwards the strict cursor and trusted correlation", async () => {
    const { calls, spies } = wire({ data: pageRow, error: null });
    await actions.listSupervisedMessagesBeforeAction({
      conversationId,
      beforeCreatedAt: "2026-09-02T00:00:00+00:00",
      beforeMessageId: messageId,
      limit: 20,
    });
    onlyCalled(spies, "listMessagesBefore");
    expect(calls).toEqual([
      {
        name: "app_list_team_supervised_messages_before",
        args: {
          p_conversation_id: conversationId,
          p_before_created_at: "2026-09-02T00:00:00+00:00",
          p_before_message_id: messageId,
          p_limit: 20,
          p_correlation_id: requestCorrelation,
        },
      },
    ]);
  });

  it("window forwards bounds and trusted correlation; a miss stays found:false", async () => {
    const { calls, spies } = wire({ data: { found: false, messages: [] }, error: null });
    const result = await actions.getSupervisedMessageWindowAction({
      conversationId,
      targetMessageId: messageId,
      beforeLimit: 5,
      afterLimit: 5,
    });
    expect(result).toEqual({ ok: true, data: { found: false } });
    onlyCalled(spies, "getMessageWindow");
    expect(calls[0]).toEqual({
      name: "app_get_team_supervised_message_window",
      args: {
        p_conversation_id: conversationId,
        p_target_message_id: messageId,
        p_before_limit: 5,
        p_after_limit: 5,
        p_correlation_id: requestCorrelation,
      },
    });
  });

  it("search sends the query to its one RPC only, with trusted correlation", async () => {
    const logs = ["log", "info", "warn", "error", "debug"].map((level) =>
      vi.spyOn(console, level as "log").mockImplementation(() => undefined),
    );
    const { calls, spies } = wire({
      data: { results: [], has_more: false, next_before_created_at: null, next_before_message_id: null },
      error: null,
    });
    const result = await actions.searchSupervisedConversationAction({ conversationId, query: secretQuery });
    expect(result).toEqual({ ok: true, data: { results: [], hasMore: false, nextCursor: null } });
    onlyCalled(spies, "searchConversation");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("app_search_team_supervised_conversation_messages");
    expect(calls[0]?.args.p_query).toBe(secretQuery);
    expect(calls[0]?.args.p_correlation_id).toBe(requestCorrelation);
    // The correlation helper takes no input; the query never reaches it.
    for (const call of currentCorrelationId.mock.calls) expect(call).toEqual([]);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });

  it("no trusted request id means no correlation at all, never the caller's", async () => {
    currentCorrelationId.mockResolvedValue(null);
    const { calls } = wire({ data: pageRow, error: null });
    await actions.getSupervisedConversationAction({ conversationId, correlationId: spoofedCorrelation });
    expect(calls[0]?.args.p_correlation_id).toBeUndefined();
  });
});

type ActionName =
  | "listSupervisedConversationsAction"
  | "getSupervisedConversationAction"
  | "listSupervisedMessagesBeforeAction"
  | "getSupervisedMessageWindowAction"
  | "searchSupervisedConversationAction";

/** One valid input per action, so a failure can only come from the service/DB path. */
const validInputs: Record<ActionName, unknown> = {
  listSupervisedConversationsAction: {},
  getSupervisedConversationAction: { conversationId },
  listSupervisedMessagesBeforeAction: {
    conversationId,
    beforeCreatedAt: "2026-09-02T00:00:00+00:00",
    beforeMessageId: messageId,
  },
  getSupervisedMessageWindowAction: { conversationId, targetMessageId: messageId },
  searchSupervisedConversationAction: { conversationId, query: secretQuery },
};
const allActions = Object.keys(validInputs) as ActionName[];

function run(action: ActionName, input: unknown = validInputs[action]) {
  return (actions[action] as (value: unknown) => Promise<unknown>)(input);
}

const safe = {
  validation: { code: "VALIDATION_ERROR", message: "The supplied data is invalid." },
  databaseValidation: { code: "VALIDATION_ERROR", message: "The data violates a database constraint." },
  notFound: { code: "NOT_FOUND", message: "Team conversation was not found." },
  forbidden: { code: "PERMISSION_DENIED", message: "You do not have permission to perform this operation." },
  rateLimited: { code: "RATE_LIMITED", message: "Too many requests. Please wait a moment and try again." },
  databaseError: { code: "DATABASE_ERROR", message: "The database operation failed." },
  unknownError: { code: "DATABASE_ERROR", message: "The operation failed." },
};

/** Anything a raw failure could carry that must never reach the browser. */
const leakPattern = new RegExp(
  [
    "private\\.",
    "app_",
    "team\\.supervision",
    "unavailable",
    "permission required",
    "SQLSTATE",
    "stack",
    conversationId,
    requestCorrelation,
    secretQuery,
  ].join("|"),
);

describe("team supervision error contract: validation happens before any RPC", () => {
  it.each([
    ["list over limit", "listSupervisedConversationsAction", { limit: 101 }],
    ["detail bad uuid", "getSupervisedConversationAction", { conversationId: "not-a-uuid" }],
    ["detail non-object", "getSupervisedConversationAction", "11111111-1111-4111-8111-111111111111"],
    ["history half cursor", "listSupervisedMessagesBeforeAction", { conversationId, beforeMessageId: messageId }],
    ["window side over 100", "getSupervisedMessageWindowAction", { conversationId, targetMessageId: messageId, beforeLimit: 101 }],
    ["search too long", "searchSupervisedConversationAction", { conversationId, query: `${secretQuery}${"x".repeat(201)}` }],
    ["search without conversation", "searchSupervisedConversationAction", { query: "needle" }],
  ] as const)("%s", async (_label, action, input) => {
    const { calls, spies } = wire({ data: null, error: null });
    const result = await run(action, input);
    expect(result).toEqual({ ok: false, error: safe.validation });
    expect(JSON.stringify(result)).not.toContain(secretQuery);
    expect(calls).toEqual([]);
    // The service is entered, but its schema refuses before the repository runs.
    for (const spy of Object.values(spies)) {
      for (const outcome of spy.mock.results) expect(outcome.type).toBe("return");
    }
  });
});

describe("team supervision error contract: one mapper for all five actions", () => {
  const cases = [
    ["P0002 safe boundary", { code: "P0002", message: "team conversation unavailable" }, safe.notFound],
    ["42501 missing capability", { code: "42501", message: "team supervision permission required" }, safe.forbidden],
    ["22023 invalid cursor", { code: "22023", message: "invalid search cursor" }, safe.databaseValidation],
    ["unexpected database", { code: "XX000", message: `relation private.x failed at app_get_team_supervised_conversation ${conversationId}` }, safe.databaseError],
  ] as const;

  for (const action of allActions) {
    it.each(cases)(`${action}: %s`, async (_label, dbError, expected) => {
      wire({ data: null, error: dbError });
      const result = await run(action);
      expect(result).toEqual({ ok: false, error: expected });
      expect(JSON.stringify(result)).not.toMatch(leakPattern);
    });
  }

  it.each(allActions)("%s: a non-database throw is the generic failure", async (action) => {
    getInternalContext.mockRejectedValue(new Error(`boom ${secretQuery} stack at private.fn`));
    const result = await run(action);
    expect(result).toEqual({ ok: false, error: safe.unknownError });
  });
});

describe("team supervision error contract: resource ambiguity", () => {
  it.each(allActions.filter((action) => action !== "listSupervisedConversationsAction"))(
    "%s: every P0002 variant is the same result",
    async (action) => {
      // The database raises one P0002 for nonexistent, group, client/mixed and
      // malformed conversations. Even if its text, detail or hint differed,
      // the browser must see one identical result.
      const variants = [
        { code: "P0002", message: "team conversation unavailable" },
        { code: "P0002", message: "group conversation", details: "kind=group" },
        { code: "P0002", message: "client member present", hint: "mixed" },
        { code: "P0002", message: "malformed direct pair", details: "member_count=3" },
      ];
      const results = [];
      for (const error of variants) {
        wire({ data: null, error });
        results.push(JSON.stringify(await run(action)));
      }
      expect(new Set(results)).toEqual(new Set([JSON.stringify({ ok: false, error: safe.notFound })]));
    },
  );

  it("a missing target and a target in another conversation are the same success", async () => {
    // Both are the database's `{ found: false }` with no audit.
    const outputs = [];
    for (const targetMessageId of [messageId, "33333333-3333-4333-8333-333333333333"]) {
      wire({ data: { found: false, messages: [] }, error: null });
      outputs.push(await run("getSupervisedMessageWindowAction", { conversationId, targetMessageId }));
    }
    expect(outputs[0]).toEqual({ ok: true, data: { found: false } });
    expect(outputs[1]).toEqual(outputs[0]);
  });

  it("a permission refusal names no conversation", async () => {
    wire({ data: null, error: { code: "42501", message: `denied for ${conversationId}` } });
    const result = await run("getSupervisedConversationAction");
    expect(result).toEqual({ ok: false, error: safe.forbidden });
    expect(JSON.stringify(result)).not.toContain(conversationId);
  });
});

describe("team supervision error contract: search rate limit", () => {
  it("WF429 is RATE_LIMITED, not not-found, and leaks no bucket, key or query", async () => {
    const logs = ["log", "info", "warn", "error", "debug"].map((level) =>
      vi.spyOn(console, level as "log").mockImplementation(() => undefined),
    );
    wire({
      data: null,
      error: {
        code: "WF429",
        message: "rate limit exceeded",
        details: `team.supervision.search.actor ${messageId} 61/60`,
      },
    });
    const result = await run("searchSupervisedConversationAction");
    expect(result).toEqual({ ok: false, error: safe.rateLimited });
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`team\\.supervision|${messageId}|61|${secretQuery}`));
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });
});

describe("team supervision error contract: expired session", () => {
  it.each(allActions)("%s lets getInternalContext's /login redirect through", async (action) => {
    let redirectError: unknown;
    try {
      redirect("/login");
    } catch (error) {
      redirectError = error;
    }
    getInternalContext.mockRejectedValue(redirectError);
    await expect(run(action)).rejects.toBe(redirectError);
  });
});

describe("team supervision entry-point boundary (source)", () => {
  const actionSource = readFileSync("src/app/actions/team-supervision.ts", "utf8");
  const nextServer = readFileSync("src/lib/supabase/next-server.ts", "utf8");

  it("is a server action module with exactly the five read actions", () => {
    expect(actionSource.startsWith('"use server";')).toBe(true);
    const exported = [...actionSource.matchAll(/export async function (\w+)/g)].map((m) => m[1]).sort();
    expect(exported).toEqual([
      "getSupervisedConversationAction",
      "getSupervisedMessageWindowAction",
      "listSupervisedConversationsAction",
      "listSupervisedMessagesBeforeAction",
      "searchSupervisedConversationAction",
    ]);
  });

  it("uses no privileged client, role check, cache, revalidation, logging or participant call", () => {
    expect(actionSource).not.toMatch(
      /trusted-server-client|auth-admin|createTrusted|SECRET_KEY|roleName|role ===|context\.user|context\.actor|\.permissions|unstable_cache|revalidatePath|revalidateTag|console\.|services\.team\.|\.rpc\(|\.from\(/,
    );
  });

  it("builds the service per request on the same user-scoped client as the internal context", () => {
    const start = nextServer.indexOf("export const getInternalContext = cache(");
    const end = nextServer.indexOf("export const getTeamActorContext");
    const body = nextServer.slice(start, end);
    expect(body).toMatch(/const client = createUserSupabaseClient\(environment, data\.session\.access_token\);/);
    expect(body).toMatch(/teamSupervision: new TeamSupervisionService\(\{\s*repository: new TeamSupervisionRepository\(client\),/);
    expect(body).not.toMatch(/createTrustedServerClient/);
    // Only the internal context constructs it.
    expect(nextServer.match(/new TeamSupervisionService/g)).toHaveLength(1);
  });

  it("no client module imports the supervision service, repository or server context", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk("src/app");
    walk("src/components");
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/.test(source.replace(/^﻿/, ""))) continue;
      // A type-only import is erased; a value import would pull server code in.
      expect(source, file).not.toMatch(
        /team-supervision-(repository|service)|^import (?!type )[^;]*supabase\/next-server/m,
      );
    }
  });
});

describe("team supervision adversarial input (Phase 2B-4)", () => {
  const cursorTime = "2026-09-02T00:00:00+00:00";

  it.each([
    ["list limit 0", "listSupervisedConversationsAction", { limit: 0 }],
    ["list negative limit", "listSupervisedConversationsAction", { limit: -1 }],
    ["list fractional limit", "listSupervisedConversationsAction", { limit: 1.5 }],
    ["list huge limit", "listSupervisedConversationsAction", { limit: 1e9 }],
    ["list string limit", "listSupervisedConversationsAction", { limit: "10" }],
    ["list malformed cursor time", "listSupervisedConversationsAction", { beforeLastMessageAt: "yesterday", beforeConversationId: conversationId }],
    ["list bad cursor uuid", "listSupervisedConversationsAction", { beforeConversationId: "nope" }],
    ["detail limit 0", "getSupervisedConversationAction", { conversationId, limit: 0 }],
    ["detail sql-looking id", "getSupervisedConversationAction", { conversationId: "' or 1=1 --" }],
    ["history time without offset", "listSupervisedMessagesBeforeAction", { conversationId, beforeCreatedAt: "2026-09-02T00:00:00", beforeMessageId: messageId }],
    ["history bad cursor uuid", "listSupervisedMessagesBeforeAction", { conversationId, beforeCreatedAt: cursorTime, beforeMessageId: "nope" }],
    ["history time only", "listSupervisedMessagesBeforeAction", { conversationId, beforeCreatedAt: cursorTime }],
    ["history limit 101", "listSupervisedMessagesBeforeAction", { conversationId, beforeCreatedAt: cursorTime, beforeMessageId: messageId, limit: 101 }],
    ["window negative side", "getSupervisedMessageWindowAction", { conversationId, targetMessageId: messageId, beforeLimit: -1 }],
    ["window huge side", "getSupervisedMessageWindowAction", { conversationId, targetMessageId: messageId, afterLimit: 1e6 }],
    ["window bad target", "getSupervisedMessageWindowAction", { conversationId, targetMessageId: "nope" }],
    ["search empty", "searchSupervisedConversationAction", { conversationId, query: "" }],
    ["search whitespace", "searchSupervisedConversationAction", { conversationId, query: " \n\t " }],
    ["search max + 1", "searchSupervisedConversationAction", { conversationId, query: "x".repeat(201) }],
    ["search limit 0", "searchSupervisedConversationAction", { conversationId, query: "x", limit: 0 }],
    ["search malformed cursor", "searchSupervisedConversationAction", { conversationId, query: "x", beforeCreatedAt: "nope", beforeMessageId: messageId }],
  ] as const)("%s never reaches the database", async (_label, action, input) => {
    const { calls } = wire({ data: null, error: null });
    expect(await run(action, input)).toEqual({ ok: false, error: safe.validation });
    expect(calls).toEqual([]);
  });

  it.each([
    ["exactly max length", "x".repeat(200)],
    ["unicode", "résumé 給料 🔒"],
    ["html-looking", "<script>alert(1)</script>"],
    ["sql-looking", "'; drop table team_messages; --"],
  ])("search %s query goes verbatim to p_query only", async (_label, query) => {
    const { calls } = wire({
      data: { results: [], has_more: false, next_before_created_at: null, next_before_message_id: null },
      error: null,
    });
    const result = await run("searchSupervisedConversationAction", { conversationId, query });
    expect(result).toEqual({ ok: true, data: { results: [], hasMore: false, nextCursor: null } });
    expect(calls).toHaveLength(1);
    const { p_query, ...rest } = calls[0]!.args;
    expect(p_query).toBe(query);
    expect(JSON.stringify(rest)).not.toContain(query);
  });

  it.each([
    ["list at max", "listSupervisedConversationsAction", { limit: 100 }],
    ["window at max and zero", "getSupervisedMessageWindowAction", { conversationId, targetMessageId: messageId, beforeLimit: 100, afterLimit: 0 }],
  ] as const)("%s is accepted as one RPC", async (_label, action, input) => {
    const { calls } = wire({ data: action === "listSupervisedConversationsAction" ? [] : { found: false, messages: [] }, error: null });
    expect((await run(action, input)) as { ok: boolean }).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it.each(allActions)("%s ignores caller-supplied authority and audit fields", async (action) => {
    const authority = {
      actorId: messageId,
      supervisorId: messageId,
      profileId: messageId,
      p_actor_id: messageId,
      role: "owner",
      permission: "team_messages.supervise",
      canSupervise: true,
      supervise: true,
      organizationId: messageId,
      clientId: messageId,
      serviceRole: true,
      auditActor: messageId,
      auditAction: "team.supervision.none",
      metadata: { query: secretQuery },
    };
    const clean = wire({ data: null, error: { code: "P0002", message: "x" } });
    await run(action);
    const hostile = wire({ data: null, error: { code: "P0002", message: "x" } });
    await run(action, { ...(validInputs[action] as object), ...authority });
    expect(hostile.calls).toHaveLength(1);
    expect(hostile.calls).toEqual(clean.calls);
  });
});
