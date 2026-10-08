import { describe, expect, it, vi } from "vitest";

/*
 * Root-cause regression coverage for the bug where automatic Podcast SEO
 * sync never fired while a manual F5 always worked: `requestIsSameOrigin`
 * reads the `Origin` header, and per the Fetch spec, browsers only attach
 * `Origin` to a same-origin request when the method is NOT GET/HEAD — a
 * same-origin `fetch(url)` GET, exactly what the client poller and refetch
 * send, arrives with NO `Origin` header. These tests build requests the way
 * a real browser actually does (no Origin header on a GET) rather than the
 * way a hand-built test request might default to including one, which is
 * exactly what let the original bug ship with route-level tests never
 * having been written for these two routes' auth gate.
 */

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
}));

vi.mock("../lib/supabase/next-server", () => ({
  getInternalActorContext: vi.fn(),
}));

describe("GET /api/operations/podcast-seo/version — no Origin header on a real same-origin GET", () => {
  it("succeeds for an authenticated caller, even with no Origin header", async () => {
    const { getInternalActorContext } = await import("../lib/supabase/next-server");
    vi.mocked(getInternalActorContext).mockResolvedValue({ actor: { id: "x" }, user: { tenantId: "f0f0f0f0-0000-4000-8000-000000000001" } } as never);

    const { GET } = await import("../app/api/operations/podcast-seo/version/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe("string");
  });

  it("still refuses an unauthenticated caller with 401, not a same-origin 403", async () => {
    const { getInternalActorContext } = await import("../lib/supabase/next-server");
    vi.mocked(getInternalActorContext).mockResolvedValue(null);

    const { GET } = await import("../app/api/operations/podcast-seo/version/route");
    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("marks the response private/no-store so no edge or browser cache can serve a stale version", async () => {
    const { getInternalActorContext } = await import("../lib/supabase/next-server");
    vi.mocked(getInternalActorContext).mockResolvedValue({ actor: { id: "x" }, user: { tenantId: "f0f0f0f0-0000-4000-8000-000000000001" } } as never);

    const { GET } = await import("../app/api/operations/podcast-seo/version/route");
    const response = await GET();

    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
});

describe("GET /api/operations/podcast-seo/snapshot — no Origin header on a real same-origin GET", () => {
  it("succeeds for an authenticated caller, even with no Origin header", async () => {
    const { getInternalActorContext } = await import("../lib/supabase/next-server");
    vi.mocked(getInternalActorContext).mockResolvedValue({ actor: { id: "x" }, user: { tenantId: "f0f0f0f0-0000-4000-8000-000000000001" } } as never);

    const { GET } = await import("../app/api/operations/podcast-seo/snapshot/route");
    const response = await GET(new Request("http://localhost/api/operations/podcast-seo/snapshot"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  it("still refuses an unauthenticated caller with 401, not a same-origin 403", async () => {
    const { getInternalActorContext } = await import("../lib/supabase/next-server");
    vi.mocked(getInternalActorContext).mockResolvedValue(null);

    const { GET } = await import("../app/api/operations/podcast-seo/snapshot/route");
    const response = await GET(new Request("http://localhost/api/operations/podcast-seo/snapshot"));

    expect(response.status).toBe(401);
  });

  it("honors a ?month= query value, resolving it through the source's own allowlist rather than trusting it directly", async () => {
    const { getInternalActorContext } = await import("../lib/supabase/next-server");
    vi.mocked(getInternalActorContext).mockResolvedValue({ actor: { id: "x" }, user: { tenantId: "f0f0f0f0-0000-4000-8000-000000000001" } } as never);

    const { GET } = await import("../app/api/operations/podcast-seo/snapshot/route");
    const response = await GET(new Request("http://localhost/api/operations/podcast-seo/snapshot?month=2026-07"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    // No Google Sheets credentials exist in this test environment (KI-046), so
    // the source is unavailable and `data` is null either way — this proves
    // the route accepts and forwards the query param without throwing, not
    // that a real month was resolved (that is `podcast-workflow-service.test.ts`'s job).
    expect(body.data).toBeNull();
  });
});
