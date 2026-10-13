import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { identityLookup, IdentityLookupError, IDENTITY_UNAVAILABLE_MESSAGE } from "../lib/supabase/identity-lookup";
import { identityFailureResponse } from "../lib/supabase/identity-failure-response";
import { getClientContext, getInternalContext, getSelfServiceContext, resolveClientUser, resolveInternalUser } from "../lib/supabase/next-server";
import { signInAction } from "../app/actions/auth";
import { GET as versionRequest } from "../app/api/operations/podcast-seo/version/route";
import { recordSecurityAuditEvent } from "../lib/security/security-audit-log";
import { setSecurityLogSink, type SecurityLogRecord } from "../lib/security/security-log";
import type { UserScopedClient, VerifiedActor } from "../lib/supabase/user-client";

const ACTOR = "20000000-0000-4000-8000-000000002601";
const TENANT = "f0f0f0f0-0000-4000-8000-000000000001";
const PRIVATE_MARKER = "private-test-provider-text";
type Result = { data: unknown; error: unknown; status?: number };
const state = vi.hoisted(() => ({
  results: {} as Record<string, Result[]>,
  calls: {} as Record<string, number>,
  signOut: vi.fn(async () => ({ error: null })),
  version: vi.fn(async () => "v1"),
}));

function read(stage: string): Result {
  state.calls[stage] = (state.calls[stage] ?? 0) + 1;
  const results = state.results[stage];
  if (!results?.length) throw new Error(`Unexpected lookup ${stage}`);
  return results.length > 1 ? results.shift()! : results[0]!;
}

const client = {
  rpc: (name: string) => Promise.resolve(read(name)),
  from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve(read("profile")) }) }) }),
} as unknown as UserScopedClient;
const actor = { id: ACTOR, email: null } as VerifiedActor;

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-wf-tenant": "f0f0f0f0-0000-4000-8000-000000000001" }),
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: {
    getSession: async () => read("session"),
    signInWithPassword: async () => read("session"),
    signOut: state.signOut,
  } }),
}));
vi.mock("../lib/supabase/user-client", () => ({
  createUserSupabaseClient: () => client,
  verifyActor: async () => {
    const result = await identityLookup(() => Promise.resolve(read("claims")), "claims");
    if (!result.data) throw new IdentityLookupError("unauthenticated", "claims");
    return actor;
  },
}));
vi.mock("../lib/security/security-audit-log", () => ({ recordSecurityAuditEvent: vi.fn(async () => undefined) }));
vi.mock("../lib/security/login-protection", () => ({
  beginProtectedLogin: vi.fn(async () => ({ ok: true, context: { forwardedIp: null } })),
  clearProtectedLoginPairFailures: vi.fn(async () => undefined),
  recordProtectedLoginFailure: vi.fn(async () => undefined),
}));
vi.mock("../lib/integrations/podcast-sync-version", () => ({ getPodcastSyncVersion: state.version }));

let records: SecurityLogRecord[];
const ok = (data: unknown): Result => ({ data, error: null, status: 200 });
const failed = (status: number, code = "unknown"): Result => ({ data: null, error: { code, message: PRIVATE_MARKER }, status });
const form = () => {
  const data = new FormData();
  data.set("email", "synthetic@example.invalid");
  data.set("password", PRIVATE_MARKER);
  return data;
};

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "synthetic-key");
  records = [];
  setSecurityLogSink((record) => records.push(record));
  state.calls = {};
  state.results = {
    session: [ok({ session: { access_token: PRIVATE_MARKER } })],
    claims: [ok({ claims: { sub: ACTOR } })],
    app_current_tenant_membership: [ok([{ account_class: "internal", role_name: "staff", tenant_id: TENANT }])],
    profile: [ok({ id: ACTOR, display_name: "Synthetic Staff", avatar_url: null, archived_at: null })],
    app_current_user_permissions: [ok([{ permission_key: "users.view" }])],
    app_current_user_modules: [ok([{ module_key: "team", granted: true }])],
    app_get_client_account_context: [failed(403, "42501")],
  };
  vi.clearAllMocks();
});
afterEach(() => { setSecurityLogSink(null); vi.unstubAllEnvs(); });

describe("shared context identity classification", () => {
  it("establishes valid staff from the current Tenant and records no denial", async () => {
    const context = await getInternalContext();
    expect(context.user).toMatchObject({ id: ACTOR, role: "staff", tenantId: TENANT, team: { view: true }, modules: { team: true } });
    expect(recordSecurityAuditEvent).not.toHaveBeenCalled();
  });

  it("retains staff-only denial and one durable audit for a genuine client", async () => {
    state.results.app_current_tenant_membership = [ok([{ account_class: "client", role_name: "client", tenant_id: TENANT }])];
    await expect(getInternalContext()).rejects.toThrow("REDIRECT:/login?reason=staff-only");
    expect(recordSecurityAuditEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      event: "authorization.context.denied", actorId: ACTOR, outcome: "denied",
    }));
  });

  it.each(["no membership", "archived profile"])("retains refusal for %s", async (mode) => {
    if (mode === "no membership") state.results.app_current_tenant_membership = [ok([])];
    else state.results.profile = [ok({ id: ACTOR, archived_at: "2026-10-13T00:00:00Z" })];
    await expect(getInternalContext()).rejects.toThrow("REDIRECT:/login?reason=staff-only");
    expect(recordSecurityAuditEvent).toHaveBeenCalledTimes(1);
  });

  it.each(["invalid_jwt", "session_not_found", "session_expired"])("rejects %s without a non-staff audit", async (code) => {
    state.results.claims = [failed(code === "invalid_jwt" ? 400 : 401, code)];
    await expect(getInternalContext()).rejects.toThrow("REDIRECT:/login");
    expect(state.calls.claims).toBe(1);
    expect(records).toContainEqual(expect.objectContaining({ event: "auth.session.unverified" }));
    expect(recordSecurityAuditEvent).not.toHaveBeenCalled();
  });

  it("does not establish a user from an absent session", async () => {
    state.results.session = [ok({ session: null })];
    await expect(getInternalContext()).rejects.toThrow("REDIRECT:/login");
    expect(state.calls.claims).toBeUndefined();
    expect(recordSecurityAuditEvent).not.toHaveBeenCalled();
  });

  it("recovers one transient 503 read followed by positive authorization", async () => {
    state.results.app_current_tenant_membership = [failed(503), ...state.results.app_current_tenant_membership!];
    expect((await getInternalContext()).user.role).toBe("staff");
    expect(state.calls.app_current_tenant_membership).toBe(2);
    expect(recordSecurityAuditEvent).not.toHaveBeenCalled();
  });

  it.each(["app_current_tenant_membership", "profile", "app_current_user_permissions", "app_current_user_modules"])(
    "fails closed on persistent %s failure, without empty grants or a denial audit", async (stage) => {
      state.results[stage] = [failed(503)];
      await expect(getInternalContext()).rejects.toThrow("REDIRECT:/login?reason=identity-unavailable");
      expect(state.calls[stage]).toBe(stage === "profile" ? 1 : 2);
      expect(records).toContainEqual(expect.objectContaining({ event: "system.database.failed", outcome: "failed", category: "system" }));
      expect(recordSecurityAuditEvent).not.toHaveBeenCalled();
      expect(JSON.stringify(records)).not.toContain(PRIVATE_MARKER);
    },
  );

  it("does not retry an unexplained lookup 401 or label it non-staff", async () => {
    state.results.app_current_tenant_membership = [failed(401), ...state.results.app_current_tenant_membership!];
    await expect(getInternalContext()).rejects.toThrow("REDIRECT:/login?reason=identity-unavailable");
    expect(state.calls.app_current_tenant_membership).toBe(1);
    expect(recordSecurityAuditEvent).not.toHaveBeenCalled();
  });

  it("recognizes PostgREST invalid JWT without a staff-only refusal", async () => {
    state.results.app_current_tenant_membership = [failed(401, "PGRST301")];
    await expect(getInternalContext()).rejects.toThrow("REDIRECT:/login");
    expect(recordSecurityAuditEvent).not.toHaveBeenCalled();
  });

  it("keeps mixed negative identity and failed capability reads unavailable", async () => {
    state.results.app_current_tenant_membership = [ok([])];
    state.results.app_current_user_modules = [failed(503)];
    await expect(getInternalContext()).rejects.toThrow("REDIRECT:/login?reason=identity-unavailable");
    expect(recordSecurityAuditEvent).not.toHaveBeenCalled();
  });

  it("requires fresh successful profile information too", async () => {
    state.results.profile = [failed(401)];
    await expect(resolveInternalUser(client, actor)).rejects.toMatchObject({ kind: "unavailable", stage: "profile" });
  });

  it.each(["app_current_tenant_membership", "app_current_user_permissions", "app_current_user_modules"])(
    "does not turn malformed successful %s output into a denial or empty grants", async (stage) => {
      state.results[stage] = [ok(null)];
      await expect(getInternalContext()).rejects.toThrow("REDIRECT:/login?reason=identity-unavailable");
      expect(recordSecurityAuditEvent).not.toHaveBeenCalled();
    },
  );

  it("preserves the client RPC's explicit assignment denial", async () => {
    expect(await resolveClientUser(client, actor)).toBeNull();
    await expect(getClientContext()).rejects.toThrow("REDIRECT:/login?reason=client-only");
  });

  it("client lookup failure is retryable and is not audited as assignment denial", async () => {
    state.results.app_get_client_account_context = [failed(401)];
    await expect(getClientContext()).rejects.toThrow("REDIRECT:/login?reason=identity-unavailable&next=/account");
    expect(recordSecurityAuditEvent).not.toHaveBeenCalled();
  });

  it("client modules are required even when the account lookup succeeds", async () => {
    state.results.app_get_client_account_context = [ok([{ profile_id: ACTOR, company_id: "company", company_name: "Synthetic", display_name: "Client" }])];
    state.results.app_current_user_modules = [failed(503)];
    await expect(resolveClientUser(client, actor)).rejects.toMatchObject({ kind: "unavailable", stage: "modules" });
  });

  it("self-service also distinguishes an unavailable claims verifier", async () => {
    state.results.claims = [failed(503)];
    await expect(getSelfServiceContext()).rejects.toThrow("REDIRECT:/login?reason=identity-unavailable");
    expect(recordSecurityAuditEvent).not.toHaveBeenCalled();
  });
});

describe("login and route response propagation", () => {
  it("keeps the established login session on identity outage, without unassigned audit", async () => {
    state.results.app_current_tenant_membership = [failed(401)];
    expect(await signInAction({ error: null }, form())).toEqual({ error: IDENTITY_UNAVAILABLE_MESSAGE });
    expect(state.signOut).not.toHaveBeenCalled();
    expect(recordSecurityAuditEvent).not.toHaveBeenCalled();
    expect(records.some((record) => record.event === "auth.login.unassigned")).toBe(false);
    expect(JSON.stringify(records)).not.toContain(PRIVATE_MARKER);
  });

  it("retains genuine unassigned login refusal and sign-out", async () => {
    state.results.app_current_tenant_membership = [ok([])];
    expect((await signInAction({ error: null }, form())).error).toContain("not active");
    expect(state.signOut).toHaveBeenCalledTimes(1);
    expect(recordSecurityAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "auth.login.unassigned" }));
  });

  it("returns 503 for a protected background lookup outage before its data read", async () => {
    state.results.app_current_tenant_membership = [failed(503)];
    const response = await versionRequest();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ ok: false, error: IDENTITY_UNAVAILABLE_MESSAGE, retryable: true });
    expect(state.version).not.toHaveBeenCalled();
    expect(recordSecurityAuditEvent).not.toHaveBeenCalled();
  });

  it("returns 403 for established non-staff and 401 for expired authentication", async () => {
    state.results.app_current_tenant_membership = [ok([])];
    expect((await versionRequest()).status).toBe(403);
    state.results.claims = [failed(400, "invalid_jwt")];
    expect((await versionRequest()).status).toBe(401);
    expect(state.version).not.toHaveBeenCalled();
  });

  it("does not relabel unrelated exceptions as identity outages", async () => {
    const error = new Error("programming error");
    await expect(identityFailureResponse(error)).rejects.toBe(error);
  });
});

describe("bounded lookup recovery", () => {
  it("retries one rejected network read then succeeds", async () => {
    const read = vi.fn().mockRejectedValueOnce(new TypeError(PRIVATE_MARKER)).mockResolvedValue(ok([]));
    await expect(identityLookup(read, "membership")).resolves.toMatchObject({ data: [] });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("caps persistent network failures and drops provider details", async () => {
    const read = vi.fn().mockRejectedValue(new TypeError(PRIVATE_MARKER));
    await expect(identityLookup(read, "membership")).rejects.toMatchObject({ kind: "unavailable", stage: "membership" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not repeat session refresh, stack retries on profile GET, or retry throttles/unknown 4xx", async () => {
    for (const [stage, status] of [["session", 503], ["profile", 503], ["membership", 429], ["membership", 400]] as const) {
      const read = vi.fn().mockResolvedValue(failed(status));
      await expect(identityLookup(read, stage)).rejects.toMatchObject({ kind: "unavailable" });
      expect(read).toHaveBeenCalledTimes(1);
    }
  });
});
