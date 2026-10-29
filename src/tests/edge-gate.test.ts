import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { TenantHostCache } from "../lib/edge/tenant-host-cache";

const TENANT = "f0f0f0f0-0000-4000-8000-000000000001";
const OTHER_TENANT = "f0f0f0f0-0000-4000-8000-000000002601";
const state = vi.hoisted(() => ({
  resolve: vi.fn(),
  claims: vi.fn(),
  localQa: vi.fn(),
  ensureQa: vi.fn(),
  cookies: undefined as undefined | { setAll: (cookies: { name: string; value: string; options: { path: string; maxAge: number } }[]) => void },
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: state.resolve }) }));
vi.mock("@supabase/ssr", async (importOriginal) => ({
  ...await importOriginal<typeof import("@supabase/ssr")>(),
  createServerClient: (_url: string, _key: string, options: { cookies: typeof state.cookies }) => {
    state.cookies = options.cookies;
    return { auth: { getClaims: state.claims } };
  },
}));
vi.mock("../lib/qa/local-ui-bypass", () => ({ localUiQaBypassEnabled: state.localQa, ensureLocalQaSession: state.ensureQa }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:1");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "edge-test-placeholder");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
  state.resolve.mockResolvedValue({ data: TENANT, error: null });
  state.claims.mockResolvedValue({ data: null, error: null });
  state.localQa.mockResolvedValue(false);
  state.cookies = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function request(path = "/dashboard", method = "GET", headers: Record<string, string> = {}) {
  const { proxy } = await import("../proxy");
  return proxy(new NextRequest(`https://workspace.test${path}`, {
    method,
    headers: { host: "workspace.test", ...headers },
  }));
}

describe("per-instance tenant host cache", () => {
  it("misses once, shares normalized host hits, expires at 60s without sliding on reads", async () => {
    await request();
    vi.setSystemTime(59_999);
    const hit = await request("/login", "GET", { host: "WORKSPACE.test.:443" });
    expect(hit.headers.get("x-middleware-request-x-wf-tenant")).toBe(TENANT);
    expect(state.resolve).toHaveBeenCalledExactlyOnceWith("app_resolve_tenant_host", { p_host: "workspace.test" });
    vi.setSystemTime(60_000);
    state.resolve.mockResolvedValue({ data: null, error: null });
    expect((await request()).status).toBe(404);
    expect(state.resolve).toHaveBeenCalledTimes(2);
  });

  it("caches unknown hosts for only 10s and never checks their session", async () => {
    state.resolve.mockResolvedValue({ data: null, error: null });
    expect((await request()).status).toBe(404);
    vi.setSystemTime(9_999);
    expect((await request()).status).toBe(404);
    expect(state.resolve).toHaveBeenCalledTimes(1);
    expect(state.claims).not.toHaveBeenCalled();
    vi.setSystemTime(10_000);
    state.resolve.mockResolvedValue({ data: TENANT, error: null });
    expect((await request()).status).toBe(200);
    expect(state.resolve).toHaveBeenCalledTimes(2);
  });

  it("separates tenants by host and overwrites a forged selector even on a cache hit", async () => {
    await request();
    state.resolve.mockResolvedValue({ data: OTHER_TENANT, error: null });
    const other = await request("/login", "GET", { host: "other.test", "x-wf-tenant": TENANT });
    expect(other.headers.get("x-middleware-request-x-wf-tenant")).toBe(OTHER_TENANT);
    const cached = await request("/login", "GET", { "x-wf-tenant": OTHER_TENANT });
    expect(cached.headers.get("x-middleware-request-x-wf-tenant")).toBe(TENANT);
    expect(state.resolve).toHaveBeenCalledTimes(2);
    expect(state.claims).toHaveBeenCalledTimes(3);
  });

  it("does not cache resolver errors as unknown hosts", async () => {
    state.resolve.mockResolvedValueOnce({ data: null, error: new Error("offline") });
    expect((await request()).status).toBe(503);
    expect((await request()).status).toBe(200);
    expect(state.resolve).toHaveBeenCalledTimes(2);
  });

  it("bounds the cache to 200 entries, evicting the oldest insertion", () => {
    const cache = new TenantHostCache();
    for (let index = 0; index < 200; index++) cache.set(`${index}.test`, index % 2 ? TENANT : null);
    cache.set("200.test", OTHER_TENANT);
    expect(cache.get("0.test")).toBeUndefined();
    expect(cache.get("1.test")).toBe(TENANT);
    expect(cache.get("200.test")).toBe(OTHER_TENANT);
    // Updating an existing entry does not evict another host or extend a different entry's TTL.
    cache.set("1.test", OTHER_TENANT);
    expect(cache.get("2.test")).toBeNull();
    expect(cache.get("1.test")).toBe(OTHER_TENANT);
  });
});

describe("anonymous root shortcut", () => {
  it.each(["/", "/?next=/orders&reason=staff-only"])("redirects GET %s to exactly /login, without next or reason", async (path) => {
    const response = await request(path);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://workspace.test/login");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["/login", "/f/example", "/activate", "/launch", "/api/team-live", "/push-sw.js", "/dashboard", "/account", "/missing"])("does not redirect %s", async (path) => {
    const response = await request(path);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["POST", "HEAD", "OPTIONS"])("does not redirect %s /", async (method) => {
    expect((await request("/", method)).headers.get("location")).toBeNull();
  });

  it("leaves authenticated root routing to the page", async () => {
    state.claims.mockResolvedValue({ data: { claims: { sub: "actor" } }, error: null });
    expect((await request("/")).headers.get("x-middleware-next")).toBe("1");
  });

  it("leaves identity outage reason handling to the page", async () => {
    state.claims.mockResolvedValue({ data: null, error: new Error("verifier unavailable") });
    expect((await request("/")).headers.get("x-middleware-next")).toBe("1");
  });

  it("rechecks a real local QA session after automatic sign-in before applying the gate", async () => {
    state.localQa.mockResolvedValue(true);
    state.claims.mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { claims: { sub: "qa-actor" } }, error: null });
    expect((await request("/")).headers.get("x-middleware-next")).toBe("1");
    expect(state.ensureQa).toHaveBeenCalledTimes(1);
  });

  it("preserves hardened session-cookie deletions on early responses", async () => {
    state.claims.mockImplementation(async () => {
      state.cookies!.setAll([{ name: "sb-session", value: "", options: { path: "/", maxAge: 0 } }]);
      return { data: null, error: null };
    });
    for (const response of [await request("/"), await request("/orders", "POST", { "next-action": "id" })]) {
      const cookie = response.cookies.get("sb-session");
      expect(cookie).toMatchObject({ value: "", path: "/", maxAge: 0, httpOnly: true });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});

const publicActionPaths = ["/login", "/f/example", "/f/nested/example", "/activate", "/client-support/exit"];
const protectedActionPaths = ["/", "/dashboard", "/orders", "/account", "/api/team-live", "/launch", "/missing", "/orders/test.css", "/push-sw.js", "/login-extra", "/activate-extra", "/f", "/forms/example", "/client-support/exit-extra"];

describe("Next-Action POST gate", () => {
  it("redirects an expired generic action to login with the validated current page and query", async () => {
    state.claims.mockResolvedValue({ data: null, error: new Error("JWT expired") });
    const response = await request("/orders?status=open&next=https%3A%2F%2Fevil.test", "POST", { "next-action": "generic-action" });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-action-redirect")).toBe("/login?next=%2Forders%3Fstatus%3Dopen%26next%3Dhttps%253A%252F%252Fevil.test;replace");
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it.each([
    ["account menu", "/dashboard"],
    ["client sidebar", "/account/projects"],
  ])("clears expired sign-out cookies from the %s and directs the user to login", async (_surface, path) => {
    vi.stubEnv("NODE_ENV", "production");
    state.claims.mockResolvedValue({ data: null, error: new Error("JWT expired") });
    const response = await request(path, "POST", {
      "next-action": "sign-out-action",
      cookie: "sb-127-auth-token=stale; sb-127-auth-token.0=expired; sb-127-auth-token.1=expired; preference=keep; sb-other-auth-token=keep",
    });
    expect(response.status).toBe(200);
    const redirect = response.headers.get("x-action-redirect")?.split(";")[0];
    expect(redirect).toBeDefined();
    expect(new URL(redirect!, "https://workspace.test").pathname).toBe("/login");
    for (const name of ["sb-127-auth-token", "sb-127-auth-token.0", "sb-127-auth-token.1"]) {
      expect(response.cookies.get(name)).toMatchObject({ value: "", path: "/", maxAge: 0, httpOnly: true, secure: true, sameSite: "lax" });
    }
    expect(response.cookies.get("preference")).toBeUndefined();
    expect(response.cookies.get("sb-other-auth-token")).toBeUndefined();
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it("never puts an unsafe request path in the sign-in next parameter", async () => {
    const response = await request("//evil.test/orders", "POST", { "next-action": "generic-action" });
    expect(response.headers.get("x-action-redirect")).toBe("/login?next=%2F;replace");
  });

  it.each(publicActionPaths)("allows anonymous actions on %s", async (path) => {
    expect((await request(path, "POST", { "next-action": "id" })).headers.get("x-middleware-next")).toBe("1");
  });

  it.each(protectedActionPaths)("rejects anonymous action POST %s before the route runs", async (path) => {
    const response = await request(path, "POST", { "Next-Action": "id" });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-action-redirect")).toMatch(/^\/login\?next=.*;replace$/);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it.each([...publicActionPaths, ...protectedActionPaths])("passes authenticated action POST %s to existing authorization", async (path) => {
    state.claims.mockResolvedValue({ data: { claims: { sub: "actor" } }, error: null });
    expect((await request(path, "POST", { "next-action": "id" })).headers.get("x-middleware-next")).toBe("1");
  });

  it("fails closed for missing subjects and verifier errors", async () => {
    for (const result of [
      { data: { claims: {} }, error: null },
      { data: { claims: { sub: "actor" } }, error: new Error("unverified") },
    ]) {
      state.claims.mockResolvedValue(result);
      const response = await request("/orders", "POST", { "next-action": "id" });
      expect(response.headers.get("x-action-redirect")).toBe("/login?next=%2Forders;replace");
      expect(response.headers.get("x-middleware-next")).toBeNull();
    }
  });

  it("does not gate ordinary POSTs or non-POST requests with an action header", async () => {
    expect((await request("/orders", "POST")).headers.get("x-middleware-next")).toBe("1");
    expect((await request("/orders", "GET", { "next-action": "id" })).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("Next's compiled proxy matcher", () => {
  const assets = [
    "/favicon.ico", "/manifest.webmanifest", "/robots.txt", "/sitemap.xml", "/push-sw.js", "/assets/app.js.map",
    "/fonts/a.woff", "/fonts/a.woff2", "/fonts/a.ttf", "/fonts/a.otf", "/styles/app.css",
    "/media/a.mp3", "/media/a.mp4", "/media/a.webm", "/branding/a.svg", "/branding/a.png", "/branding/a.jpg",
    "/branding/a.jpeg", "/branding/a.gif", "/branding/a.webp", "/_next/static/app.js", "/_next/image?url=x&w=32&q=75",
  ];

  async function matches(url: string, headers: Record<string, string> = {}) {
    const { config } = await import("../proxy");
    return unstable_doesMiddlewareMatch({ config, nextConfig: {}, url, headers });
  }

  it.each(assets)("excludes public asset %s, including query strings", async (path) => {
    expect(await matches(path)).toBe(false);
    expect(await matches(`${path}${path.includes("?") ? "&" : "?"}v=1`)).toBe(false);
  });

  it.each(["/", "/login", "/f/example", "/activate", "/api/team-live", "/account", "/missing", "/orders/app.css/edit"])("still includes app path %s", async (path) => {
    expect(await matches(path)).toBe(true);
  });

  it.each(assets)("forces a forged tenant header through the proxy on %s and replaces it", async (path) => {
    for (const value of [OTHER_TENANT, "forged"]) {
      expect(await matches(path, { "x-wf-tenant": value })).toBe(true);
      const response = await request(path, "GET", { "x-wf-tenant": value });
      expect(response.headers.get("x-middleware-request-x-wf-tenant")).toBe(TENANT);
    }
  });

  it.each(assets)("also forces action headers through on excluded path %s", async (path) => {
    expect(await matches(path, { "next-action": "id" })).toBe(true);
    const response = await request(path, "POST", { "next-action": "id" });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-action-redirect")).toMatch(/^\/login\?next=.*;replace$/);
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });
});
