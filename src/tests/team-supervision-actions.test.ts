import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

describe("team supervision actions: validation happens before any RPC", () => {
  it.each([
    ["list over limit", "listSupervisedConversationsAction", { limit: 101 }],
    ["detail bad uuid", "getSupervisedConversationAction", { conversationId: "not-a-uuid" }],
    ["detail non-object", "getSupervisedConversationAction", "11111111-1111-4111-8111-111111111111"],
    ["history half cursor", "listSupervisedMessagesBeforeAction", { conversationId, beforeMessageId: messageId }],
    ["window side over 100", "getSupervisedMessageWindowAction", { conversationId, targetMessageId: messageId, beforeLimit: 101 }],
    ["search too long", "searchSupervisedConversationAction", { conversationId, query: "x".repeat(201) }],
    ["search without conversation", "searchSupervisedConversationAction", { query: "needle" }],
  ] as const)("%s", async (_label, action, input) => {
    const { calls } = wire({ data: null, error: null });
    const result = await (actions[action] as (value: unknown) => Promise<{ ok: boolean; error?: string }>)(input);
    expect(result).toEqual({ ok: false, error: "The supplied data is invalid." });
    expect(calls).toEqual([]);
  });
});

describe("team supervision actions: safe error propagation", () => {
  it("session failure returns the generic failure", async () => {
    getInternalContext.mockRejectedValue(new Error("Authenticated user verification failed."));
    const result = await actions.listSupervisedConversationsAction();
    expect(result).toEqual({ ok: false, error: "The operation failed." });
  });

  it.each([
    ["safe not-found", { code: "P0002", message: "team conversation unavailable" }, "Team conversation was not found."],
    ["authorization", { code: "42501", message: "team supervision permission required" }, "You do not have permission to perform this operation."],
    ["generic database", { code: "XX000", message: "relation private.x failed at app_get_team_supervised_conversation" }, "The database operation failed."],
  ])("%s maps to one client-safe message with no database detail", async (_label, dbError, message) => {
    wire({ data: null, error: dbError });
    const result = await actions.getSupervisedConversationAction({ conversationId });
    expect(result).toEqual({ ok: false, error: message });
    expect(JSON.stringify(result)).not.toMatch(/private\.|app_get_team|unavailable|permission required/);
  });

  it("a rate-limited search does not echo the query", async () => {
    wire({ data: null, error: { code: "WF429", message: "rate limited" } });
    const result = await actions.searchSupervisedConversationAction({ conversationId, query: secretQuery });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secretQuery);
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
      /trusted-server-client|auth-admin|createTrusted|SECRET_KEY|roleName|role ===|unstable_cache|revalidatePath|revalidateTag|console\.|services\.team\.|\.rpc\(|\.from\(/,
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
