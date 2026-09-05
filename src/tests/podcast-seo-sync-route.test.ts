import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPodcastSyncGuardForTests } from "../lib/security/podcast-sync-guard";
import { signOperationsWebhookPayload } from "../lib/security/operations-webhook-hmac";

/*
 * `next/headers` throws outside a real request (see security-monitoring.test.ts
 * for the same pattern) and `next/cache`'s `revalidateTag` requires a live
 * request/static-generation store that does not exist under Vitest. Both are
 * mocked so the route module — imported and invoked directly below, the way
 * no existing Team route test does but the way this security-critical
 * webhook is worth verifying end to end — can run outside Next's server.
 */
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

const revalidatedTags: unknown[] = [];
vi.mock("next/cache", () => ({
  revalidateTag: (tag: string, profile: unknown) => {
    revalidatedTags.push([tag, profile]);
  },
  /* `podcast-sync-version.ts` (imported transitively by the route, for its cache tag constant) calls this at module scope — a passthrough is enough since no test here exercises the version value itself. */
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

const SECRET = "s".repeat(48);
const ENV_KEY = "OPERATIONS_SYNC_WEBHOOK_SECRET";

function sign(body: string): string {
  return signOperationsWebhookPayload(body, SECRET);
}

/** Flips the first hex digit to a value guaranteed to differ from it — unlike a fixed replacement, this can never accidentally reproduce the original signature. */
function corrupt(signatureHex: string): string {
  const flipped = signatureHex[0] === "0" ? "1" : "0";
  return flipped + signatureHex.slice(1);
}

function buildRequest(body: string, options: { signature?: string | null } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.signature !== null) {
    headers["x-wolf-forge-signature"] = options.signature ?? sign(body);
  }
  return new Request("http://localhost:3100/api/operations/podcast-seo/sync", {
    method: "POST",
    headers,
    body,
  });
}

function validPayload(overrides: Partial<{ eventType: string; timestamp: number; nonce: string }> = {}) {
  return JSON.stringify({
    eventType: "podcast_seo_changed",
    timestamp: Date.now(),
    nonce: `nonce-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  });
}

describe("POST /api/operations/podcast-seo/sync", () => {
  const originalSecret = process.env[ENV_KEY];

  beforeEach(() => {
    process.env[ENV_KEY] = SECRET;
    resetPodcastSyncGuardForTests();
    revalidatedTags.length = 0;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalSecret;
  });

  it("accepts a validly signed, fresh, recognized-event payload and invalidates both cache tags", async () => {
    const { POST } = await import("../app/api/operations/podcast-seo/sync/route");
    const body = validPayload();

    const response = await POST(buildRequest(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(revalidatedTags).toEqual([
      ["podcast-seo-sheet", { expire: 0 }],
      ["podcast-seo-sync-version", { expire: 0 }],
    ]);
  });

  it("rejects an invalid signature and triggers no invalidation", async () => {
    const { POST } = await import("../app/api/operations/podcast-seo/sync/route");
    const body = validPayload();

    const response = await POST(buildRequest(body, { signature: corrupt(sign(body)) }));

    expect(response.status).toBe(401);
    expect(revalidatedTags).toEqual([]);
  });

  it("rejects a missing signature", async () => {
    const { POST } = await import("../app/api/operations/podcast-seo/sync/route");
    const response = await POST(buildRequest(validPayload(), { signature: null }));

    expect(response.status).toBe(401);
    expect(revalidatedTags).toEqual([]);
  });

  it("rejects a stale timestamp", async () => {
    const { POST } = await import("../app/api/operations/podcast-seo/sync/route");
    const body = validPayload({ timestamp: Date.now() - 10 * 60 * 1000 });

    const response = await POST(buildRequest(body));

    expect(response.status).toBe(400);
    expect(revalidatedTags).toEqual([]);
  });

  it("rejects a malformed payload", async () => {
    const { POST } = await import("../app/api/operations/podcast-seo/sync/route");
    const body = JSON.stringify({ eventType: "podcast_seo_changed" });

    const response = await POST(buildRequest(body));

    expect(response.status).toBe(400);
    expect(revalidatedTags).toEqual([]);
  });

  it("rejects a request body that is not even valid JSON", async () => {
    const { POST } = await import("../app/api/operations/podcast-seo/sync/route");
    const body = "{not json";

    const response = await POST(buildRequest(body));

    expect(response.status).toBe(400);
    expect(revalidatedTags).toEqual([]);
  });

  it("rejects an irrelevant/unrecognized event type", async () => {
    const { POST } = await import("../app/api/operations/podcast-seo/sync/route");
    const body = validPayload({ eventType: "podcast_seo_deleted" });

    const response = await POST(buildRequest(body));

    expect(response.status).toBe(400);
    expect(revalidatedTags).toEqual([]);
  });

  it("debounces a duplicate (exact nonce replay) event — accepted, but does not invalidate again", async () => {
    const { POST } = await import("../app/api/operations/podcast-seo/sync/route");
    const body = validPayload({ nonce: "same-nonce-123" });

    const first = await POST(buildRequest(body));
    expect(first.status).toBe(200);
    expect(revalidatedTags).toHaveLength(2);

    const second = await POST(buildRequest(body));
    expect(second.status).toBe(200);
    expect(revalidatedTags).toHaveLength(2); // unchanged — no second invalidation
  });

  it("returns 503 rather than crashing when the webhook secret is not configured", async () => {
    delete process.env[ENV_KEY];
    const { POST } = await import("../app/api/operations/podcast-seo/sync/route");

    const response = await POST(buildRequest(validPayload()));

    expect(response.status).toBe(503);
    expect(revalidatedTags).toEqual([]);
  });

  it("never echoes the shared secret or the signature back in any response", async () => {
    const { POST } = await import("../app/api/operations/podcast-seo/sync/route");
    const body = validPayload();
    const signature = sign(body);

    const responses = await Promise.all([
      POST(buildRequest(body, { signature })),
      POST(buildRequest(body, { signature: "0".repeat(64) })),
    ]);

    for (const response of responses) {
      const text = await response.text();
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(signature);
    }
  });
});
