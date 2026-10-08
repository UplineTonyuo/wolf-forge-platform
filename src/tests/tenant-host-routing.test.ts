import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { TENANT_SELECTOR_HEADER } from "../domain/tenancy/tenant-selector";
import { normalizeRequestHost } from "../domain/tenancy/request-host";

/*
 * WL-2.22b (KI-125). The request's Tenant is resolved by the real proxy from
 * the verified `Host` only, handed to server code as the proxy-set
 * `x-wf-tenant`, and sent to PostgREST by every user-client call site. The
 * network is the only fake: a stand-in PostgREST answers the host lookup from
 * `hosts` (verified, enabled, active rows only — the SQL filter is pgTAP 120)
 * and answers membership from the `x-wf-tenant` it receives, the way
 * private.current_tenant_id() does (an archived membership or a suspended
 * Tenant is simply no row — pgTAP 115 / 119 / 120).
 */

const WF = "f0f0f0f0-0000-4000-8000-000000000001";
const B = "f0f0f0f0-0000-4000-8000-000000002601";
const ACTOR = "20000000-0000-4000-8000-000000002601";
const URL_BASE = "http://127.0.0.1:54321";

const state = vi.hoisted(() => ({
  headers: new Headers(),
  hosts: {} as Record<string, string>,
  memberships: {} as Record<string, { account_class: string; role_name: string }>,
  rpcCalls: [] as { name: string; selector: string | null; body: unknown }[],
  resolverDown: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => state.headers,
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: ACTOR } } }),
      getSession: async () => ({ data: { session: { access_token: "signed-token" } }, error: null }),
      signInWithPassword: async () => ({ data: { session: { access_token: "signed-token" } }, error: null }),
      signOut: async () => ({ error: null }),
    },
  })),
}));
vi.mock("../lib/supabase/user-client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/supabase/user-client")>();
  return {
    ...real,
    createUserSupabaseClient: vi.fn(real.createUserSupabaseClient),
    verifyActor: vi.fn(async () => Object.freeze({ id: ACTOR })),
  };
});
vi.mock("../lib/security/security-audit-log", () => ({ recordSecurityAuditEvent: vi.fn(async () => undefined) }));
vi.mock("../lib/security/security-log", () => ({ recordSecurityEvent: vi.fn() }));
vi.mock("../lib/security/login-protection", () => ({
  beginProtectedLogin: vi.fn(async () => ({ ok: true, context: { forwardedIp: null } })),
  clearProtectedLoginPairFailures: vi.fn(async () => undefined),
  recordProtectedLoginFailure: vi.fn(async () => undefined),
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function fakePostgrest(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const selector = new Headers(init?.headers).get(TENANT_SELECTOR_HEADER);
  const rpc = url.pathname.match(/\/rest\/v1\/rpc\/(\w+)$/)?.[1];
  if (rpc) state.rpcCalls.push({ name: rpc, selector, body: init?.body ? JSON.parse(String(init.body)) : null });

  if (rpc === "app_resolve_tenant_host") {
    if (state.resolverDown) return json({ message: "unavailable" }, 503);
    const { p_host } = JSON.parse(String(init?.body)) as { p_host: string };
    return json(state.hosts[p_host] ?? null);
  }
  const membership = selector ? state.memberships[selector] : undefined;
  if (rpc === "app_current_tenant_membership") return json(membership ? [{ ...membership, tenant_id: selector }] : []);
  if (rpc === "app_current_user_permissions" || rpc === "app_current_user_modules") return json([]);
  if (rpc === "app_get_client_account_context") {
    return membership?.account_class === "client"
      ? json([{ profile_id: ACTOR, company_id: "c", display_name: "Client", company_name: "Co" }])
      : json({ code: "42501", message: "authenticated client account is required" }, 403);
  }
  if (url.pathname.endsWith("/rest/v1/profiles")) {
    return json({ id: ACTOR, display_name: "Person", avatar_url: null, archived_at: null });
  }
  throw new Error(`unexpected request ${url.pathname}`);
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", URL_BASE);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "local-key");
  vi.stubGlobal("fetch", vi.fn(fakePostgrest));
  state.headers = new Headers();
  state.hosts = { "wolf-forge-platform-woad.vercel.app": WF, "tenant-b.test": B };
  state.memberships = {};
  state.rpcCalls = [];
  state.resolverDown = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function route(host: string | null, extra: Record<string, string> = {}) {
  const { proxy } = await import("../proxy");
  const headers: Record<string, string> = { ...extra };
  if (host !== null) headers.host = host;
  return proxy(new NextRequest(`http://placeholder.invalid/dashboard`, { headers }));
}

/** The selector the proxy forwards upstream (not to the browser), or null. */
const forwarded = (response: Response) => response.headers.get(`x-middleware-request-${TENANT_SELECTOR_HEADER}`);

/** Routes through the real proxy, then exposes its forwarded headers to server code. */
async function serveFrom(host: string, extra: Record<string, string> = {}) {
  const response = await route(host, extra);
  expect(response.status).toBe(200);
  state.headers = new Headers({ [TENANT_SELECTOR_HEADER]: forwarded(response) ?? "" });
  state.rpcCalls = [];
}

const outboundSelectors = () =>
  state.rpcCalls.filter((call) => call.name !== "app_resolve_tenant_host").map((call) => call.selector);

describe("request host normalization", () => {
  it("keeps exact DNS hostnames, lowercased, without port or trailing dot", () => {
    expect(normalizeRequestHost("Tenant-B.Test:443")).toBe("tenant-b.test");
    expect(normalizeRequestHost("tenant-b.test.")).toBe("tenant-b.test");
    expect(normalizeRequestHost("127.0.0.1:3000")).toBe("127.0.0.1");
  });

  it("rejects anything that is not one hostname", () => {
    for (const raw of [null, "", " tenant-b.test", "tenant-b.test, evil.test", "user@tenant-b.test", "[::1]:3000",
      "tenant-b.test:port", "-bad.test", "a..test", "tenant_b.test", "tenant-b.test/x", `${"a".repeat(64)}.test`]) {
      expect(normalizeRequestHost(raw)).toBeNull();
    }
  });
});

describe("the proxy resolves the Tenant from the verified host only", () => {
  it("Wolf Forge production host -> Wolf Forge selector", async () => {
    const response = await route("wolf-forge-platform-woad.vercel.app");
    expect(forwarded(response)).toBe(WF);
    expect(state.rpcCalls[0]).toMatchObject({ name: "app_resolve_tenant_host", body: { p_host: "wolf-forge-platform-woad.vercel.app" } });
  });

  it("Tenant B host -> Tenant B selector, never Wolf Forge", async () => {
    expect(forwarded(await route("TENANT-B.test:3000"))).toBe(B);
  });

  it("unknown, unverified or disabled host (resolver returns nothing) -> neutral 404 with no session work", async () => {
    const { createServerClient } = await import("@supabase/ssr");
    const response = await route("unknown.test");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.text()).toBe("This workspace is not available.");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(forwarded(response)).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("malformed or missing host -> 404 without a lookup", async () => {
    for (const host of ["tenant-b.test, wolf-forge-platform-woad.vercel.app", "user@tenant-b.test", null]) {
      expect((await route(host)).status).toBe(404);
    }
    expect(state.rpcCalls).toEqual([]);
  });

  it("a resolver failure is 503, never a Wolf Forge fallback", async () => {
    state.resolverDown = true;
    const response = await route("tenant-b.test");
    expect(response.status).toBe(503);
    expect(forwarded(response)).toBeNull();
  });

  it("X-Forwarded-Host is ignored in both directions", async () => {
    expect((await route("unknown.test", { "x-forwarded-host": "tenant-b.test" })).status).toBe(404);
    expect(forwarded(await route("tenant-b.test", { "x-forwarded-host": "wolf-forge-platform-woad.vercel.app" }))).toBe(B);
  });

  it("a browser x-wf-tenant is overwritten by the host's Tenant", async () => {
    expect(forwarded(await route("tenant-b.test", { [TENANT_SELECTOR_HEADER]: WF }))).toBe(B);
    expect((await route("unknown.test", { [TENANT_SELECTOR_HEADER]: B })).status).toBe(404);
  });

  it("loopback keeps bounded Wolf Forge development compatibility, off Vercel only", async () => {
    expect(forwarded(await route("localhost:3000"))).toBe(WF);
    expect(forwarded(await route("127.0.0.1"))).toBe(WF);
    expect(state.rpcCalls).toEqual([]);

    vi.stubEnv("VERCEL", "1");
    expect((await route("localhost")).status).toBe(404);
  });

  it("the selector is forwarded upstream only, never echoed to the browser", async () => {
    const response = await route("tenant-b.test");
    expect(response.headers.get(TENANT_SELECTOR_HEADER)).toBeNull();
  });

  it("any request carrying a forged selector always runs the proxy", async () => {
    const { config } = await import("../proxy");
    expect(config.matcher).toContainEqual({ source: "/:path*", has: [{ type: "header", key: TENANT_SELECTOR_HEADER }] });
  });
});

describe("local LAN QA device gate (development only)", () => {
  const LAN_IP = "192.168.1.95";

  function enableLanQa() {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_QA_LAN_DEVICES", LAN_IP);
    state.hosts[LAN_IP] = WF;
  }

  it("a LAN host with an explicitly approved device IP resolves to its verified Tenant", async () => {
    enableLanQa();
    const response = await route(`${LAN_IP}:3000`, { "x-forwarded-for": LAN_IP });
    expect(response.status).toBe(200);
    expect(forwarded(response)).toBe(WF);
  });

  it.each([
    ["an unapproved IP", "203.0.113.9"],
    ["a spoofed chain", `203.0.113.9, ${LAN_IP}`],
  ])("a LAN host with %s is 404 before any Tenant lookup", async (_label, forwardedFor) => {
    enableLanQa();
    const response = await route(`${LAN_IP}:3000`, { "x-forwarded-for": forwardedFor });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("This workspace is not available.");
    expect(state.rpcCalls).toEqual([]);
  });

  it("an unapproved LAN peer claiming Host: localhost is 404 before the loopback shortcut", async () => {
    // The peer address decides, never the claimed Host: loopback hosts skip
    // tenant_domains verification, so a claimed one is not loopback evidence.
    enableLanQa();
    const response = await route("localhost:3000", { "x-forwarded-for": "203.0.113.9" });
    expect(response.status).toBe(404);
    expect(state.rpcCalls).toEqual([]);
  });

  it("a LAN host without x-forwarded-for is 404 (fail closed)", async () => {
    enableLanQa();
    expect((await route(`${LAN_IP}:3000`)).status).toBe(404);
    expect(state.rpcCalls).toEqual([]);
  });

  it("a LAN host is 404 when the allowlist is empty even in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    state.hosts[LAN_IP] = WF;
    expect((await route(`${LAN_IP}:3000`, { "x-forwarded-for": LAN_IP })).status).toBe(404);
    expect(state.rpcCalls).toEqual([]);
  });

  it("the developer's own machine is never gated, even without an allowlist", async () => {
    // `next dev` fills x-forwarded-for from the socket, so a genuinely loopback
    // request carries a loopback peer whatever host it claims.
    vi.stubEnv("NODE_ENV", "development");
    state.hosts["qa.wolf-forge.local"] = WF;
    state.hosts[LAN_IP] = WF;
    for (const host of ["localhost:3000", "qa.wolf-forge.local", `${LAN_IP}:3000`]) {
      const response = await route(host, { "x-forwarded-for": "127.0.0.1" });
      expect(forwarded(response)).toBe(WF);
    }
    expect(state.rpcCalls.filter((call) => call.name === "app_resolve_tenant_host")).toEqual([
      { name: "app_resolve_tenant_host", selector: null, body: { p_host: "qa.wolf-forge.local" } },
      { name: "app_resolve_tenant_host", selector: null, body: { p_host: LAN_IP } },
    ]);
  });

  it("outside development the gate is inert and host routing is unchanged", async () => {
    // NODE_ENV is left at vitest's default "test" and no allowlist is set.
    state.hosts[LAN_IP] = WF;
    expect(forwarded(await route(`${LAN_IP}:3000`))).toBe(WF);
  });
});

describe("every user-client call site sends the host's Tenant", () => {
  const factories = [
    "getInternalContext",
    "getInternalActorContext",
    "getTeamActorContext",
    "getTicketActorContext",
    "getSelfServiceContext",
    "getClientContext",
  ] as const;

  it.each(factories)("%s sends the proxy-resolved selector to PostgREST", async (factory) => {
    const server = await import("../lib/supabase/next-server");
    const { createUserSupabaseClient } = await import("../lib/supabase/user-client");
    state.memberships[B] = { account_class: "internal", role_name: "staff" };
    await serveFrom("tenant-b.test", { [TENANT_SELECTOR_HEADER]: WF });

    await server[factory]().catch(() => undefined);
    expect(vi.mocked(createUserSupabaseClient).mock.calls.at(-1)?.[2]).toBe(B);
  });

  it.each(factories)("%s fails closed when the proxy selector is missing", async (factory) => {
    const server = await import("../lib/supabase/next-server");
    const { createUserSupabaseClient } = await import("../lib/supabase/user-client");
    for (const value of [null, "not-a-tenant"]) {
      state.headers = new Headers(value ? { [TENANT_SELECTOR_HEADER]: value } : {});
      await expect(server[factory]()).rejects.toThrow("Tenant selector must be a UUID.");
    }
    expect(createUserSupabaseClient).not.toHaveBeenCalled();
  });
});

describe("the cookie-session client sends the host's Tenant too", () => {
  it("public Form reads and submissions are evaluated in the host's Tenant", async () => {
    const { createServerClient } = await import("@supabase/ssr");
    const { createNextServerSupabaseClient } = await import("../lib/supabase/next-server");
    await serveFrom("tenant-b.test", { [TENANT_SELECTOR_HEADER]: WF });
    await createNextServerSupabaseClient();
    const options = vi.mocked(createServerClient).mock.calls.at(-1)?.[2] as { global?: { headers?: Record<string, string> } };
    expect(options.global?.headers?.[TENANT_SELECTOR_HEADER]).toBe(B);
  });

  it("fails closed without the proxy selector", async () => {
    const { createNextServerSupabaseClient } = await import("../lib/supabase/next-server");
    await expect(createNextServerSupabaseClient()).rejects.toThrow("Tenant selector must be a UUID.");
  });
});

describe("application access follows the host's Tenant; membership decides", () => {
  async function internalContext() {
    const { getInternalContext } = await import("../lib/supabase/next-server");
    return getInternalContext();
  }
  async function clientContext() {
    const { getClientContext } = await import("../lib/supabase/next-server");
    return getClientContext();
  }

  it("Tenant B internal user on the Tenant B host -> Tenant B internal app", async () => {
    state.memberships[B] = { account_class: "internal", role_name: "staff" };
    await serveFrom("tenant-b.test");
    const context = await internalContext();
    expect(context.user.tenantId).toBe(B);
    expect(context.user.role).toBe("staff");
    expect(new Set(outboundSelectors())).toEqual(new Set([B]));
  });

  it("Tenant B client on the Tenant B host -> client portal, refused by the internal app", async () => {
    state.memberships[B] = { account_class: "client", role_name: "client" };
    await serveFrom("tenant-b.test");
    expect((await clientContext()).user.id).toBe(ACTOR);
    await expect(internalContext()).rejects.toThrow("REDIRECT:/login?reason=staff-only");
  });

  it("dual-Tenant user follows the host's Tenant", async () => {
    state.memberships[WF] = { account_class: "internal", role_name: "owner" };
    state.memberships[B] = { account_class: "client", role_name: "client" };

    await serveFrom("wolf-forge-platform-woad.vercel.app");
    expect((await internalContext()).user).toMatchObject({ tenantId: WF, role: "owner" });

    await serveFrom("tenant-b.test");
    await expect(internalContext()).rejects.toThrow("REDIRECT:/login?reason=staff-only");
    expect((await clientContext()).user.id).toBe(ACTOR);
  });

  it("a Wolf Forge-only user on the Tenant B host is denied (foreign membership)", async () => {
    state.memberships[WF] = { account_class: "internal", role_name: "owner" };
    await serveFrom("tenant-b.test");
    await expect(internalContext()).rejects.toThrow("REDIRECT:/login?reason=staff-only");
    await expect(clientContext()).rejects.toThrow("REDIRECT:/login?reason=client-only");
  });

  it("a Tenant B-only user on the Wolf Forge host is denied", async () => {
    state.memberships[B] = { account_class: "internal", role_name: "owner" };
    await serveFrom("wolf-forge-platform-woad.vercel.app");
    await expect(internalContext()).rejects.toThrow("REDIRECT:/login?reason=staff-only");
  });

  it("Wolf Forge host on loopback is unchanged for a Wolf Forge member", async () => {
    state.memberships[WF] = { account_class: "internal", role_name: "admin" };
    await serveFrom("127.0.0.1:3000");
    expect((await internalContext()).user).toMatchObject({ tenantId: WF, role: "admin" });
  });
});

describe("login resolves the surface with the host's Tenant", () => {
  const form = () => {
    const data = new FormData();
    data.set("email", "person@example.invalid");
    data.set("password", "correct horse");
    return data;
  };
  async function signIn() {
    const { signInAction } = await import("../app/actions/auth");
    return signInAction({ error: null }, form());
  }

  it("Tenant B internal -> internal app; Tenant B client -> client portal", async () => {
    state.memberships[B] = { account_class: "internal", role_name: "manager" };
    await serveFrom("tenant-b.test");
    await expect(signIn()).rejects.toThrow("REDIRECT:/");

    state.memberships[B] = { account_class: "client", role_name: "client" };
    await serveFrom("tenant-b.test");
    await expect(signIn()).rejects.toThrow("REDIRECT:/account");
    expect(new Set(outboundSelectors())).toEqual(new Set([B]));
  });

  it("no membership in the host's Tenant -> existing unassigned response", async () => {
    state.memberships[WF] = { account_class: "internal", role_name: "owner" };
    await serveFrom("tenant-b.test");
    const result = await signIn();
    expect(result.error).toBeTruthy();
    expect(result.error).not.toBe("That email and password don't match an account.");
  });

  it("a request without the proxy selector fails before any Auth work", async () => {
    const { beginProtectedLogin } = await import("../lib/security/login-protection");
    await expect(signIn()).rejects.toThrow("Tenant selector must be a UUID.");
    expect(beginProtectedLogin).not.toHaveBeenCalled();
  });
});
