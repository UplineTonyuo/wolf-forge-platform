import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSecurityLogSink, type SecurityLogRecord } from "../lib/security/security-log";

/*
 * The cleanup service itself (TeamVoiceCleanupService.runBatch) is already
 * covered against a real Storage repository in team-voice-service.test.ts.
 * This file is only about the route's own trust boundary: does a caller
 * without the exact CRON_SECRET ever reach that service, and does a caller
 * with it get back nothing but safe counts.
 */
vi.mock("../lib/team-voice/server-service", () => ({
  createTeamVoiceCleanupService: vi.fn(),
}));

const ENV_KEY = "CRON_SECRET";
const SECRET = "a".repeat(32);

function buildRequest(authorization?: string | null): Request {
  const headers: Record<string, string> = {};
  if (authorization !== null && authorization !== undefined) {
    headers.authorization = authorization;
  }
  return new Request("http://localhost:3100/api/internal/team-voice-cleanup", {
    method: "GET",
    headers,
  });
}

async function mockRunBatch(result = { selected: 0, removed: 0, failed: 0 }) {
  const { createTeamVoiceCleanupService } = await import("../lib/team-voice/server-service");
  const runBatch = vi.fn().mockResolvedValue(result);
  vi.mocked(createTeamVoiceCleanupService).mockReturnValue({ runBatch } as never);
  return runBatch;
}

describe("GET /api/internal/team-voice-cleanup", () => {
  const originalSecret = process.env[ENV_KEY];
  const logs: SecurityLogRecord[] = [];

  beforeEach(() => {
    logs.length = 0;
    setSecurityLogSink((record) => {
      logs.push(record);
    });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalSecret;
    setSecurityLogSink(null);
    vi.clearAllMocks();
  });

  it("fails closed with 503 when CRON_SECRET is not configured, and never runs cleanup", async () => {
    delete process.env[ENV_KEY];
    const runBatch = await mockRunBatch();
    const { GET } = await import("../app/api/internal/team-voice-cleanup/route");

    const response = await GET(buildRequest(`Bearer ${SECRET}`));

    expect(response.status).toBe(503);
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when CRON_SECRET is configured below the 32-character minimum", async () => {
    const shortSecret = "a".repeat(20);
    process.env[ENV_KEY] = shortSecret;
    const runBatch = await mockRunBatch();
    const { GET } = await import("../app/api/internal/team-voice-cleanup/route");

    const response = await GET(buildRequest(`Bearer ${shortSecret}`));

    expect(response.status).toBe(503);
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header with 401, and never runs cleanup", async () => {
    process.env[ENV_KEY] = SECRET;
    const runBatch = await mockRunBatch();
    const { GET } = await import("../app/api/internal/team-voice-cleanup/route");

    const response = await GET(buildRequest(null));

    expect(response.status).toBe(401);
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("rejects malformed Bearer authorization (wrong scheme, or Bearer with no token) with 401", async () => {
    process.env[ENV_KEY] = SECRET;
    const runBatch = await mockRunBatch();
    const { GET } = await import("../app/api/internal/team-voice-cleanup/route");

    const wrongScheme = await GET(buildRequest(`Token ${SECRET}`));
    const bareBearer = await GET(buildRequest("Bearer"));
    const emptyBearer = await GET(buildRequest("Bearer "));

    expect(wrongScheme.status).toBe(401);
    expect(bareBearer.status).toBe(401);
    expect(emptyBearer.status).toBe(401);
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("rejects a wrong Bearer token of a different length with 401", async () => {
    process.env[ENV_KEY] = SECRET;
    const runBatch = await mockRunBatch();
    const { GET } = await import("../app/api/internal/team-voice-cleanup/route");

    const response = await GET(buildRequest(`Bearer ${"a".repeat(10)}`));

    expect(response.status).toBe(401);
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("rejects a wrong Bearer token of the SAME length — exercises the timingSafeEqual comparison, not just the length guard", async () => {
    process.env[ENV_KEY] = SECRET;
    const runBatch = await mockRunBatch();
    const { GET } = await import("../app/api/internal/team-voice-cleanup/route");

    const wrongSameLength = "b".repeat(SECRET.length);
    expect(wrongSameLength).not.toBe(SECRET);
    expect(wrongSameLength).toHaveLength(SECRET.length);

    const response = await GET(buildRequest(`Bearer ${wrongSameLength}`));

    expect(response.status).toBe(401);
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("accepts the correct Bearer token, runs cleanup exactly once, and returns 200 with only safe counts", async () => {
    process.env[ENV_KEY] = SECRET;
    const runBatch = await mockRunBatch({ selected: 5, removed: 4, failed: 1 });
    const { GET } = await import("../app/api/internal/team-voice-cleanup/route");

    const response = await GET(buildRequest(`Bearer ${SECRET}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(runBatch).toHaveBeenCalledTimes(1);
    expect(runBatch).toHaveBeenCalledWith(100);
    expect(body).toEqual({ ok: true, data: { selected: 5, removed: 4, failed: 1 } });
    expect(Object.keys(body.data).sort()).toEqual(["failed", "removed", "selected"]);
  });

  it("marks a successful response private/no-store", async () => {
    process.env[ENV_KEY] = SECRET;
    await mockRunBatch();
    const { GET } = await import("../app/api/internal/team-voice-cleanup/route");

    const response = await GET(buildRequest(`Bearer ${SECRET}`));

    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("never echoes the configured secret in any response body, success or failure", async () => {
    process.env[ENV_KEY] = SECRET;
    await mockRunBatch();
    const { GET } = await import("../app/api/internal/team-voice-cleanup/route");

    const responses = await Promise.all([
      GET(buildRequest(`Bearer ${SECRET}`)),
      GET(buildRequest(`Bearer ${"b".repeat(SECRET.length)}`)),
      GET(buildRequest(null)),
    ]);

    for (const response of responses) {
      const text = await response.text();
      expect(text).not.toContain(SECRET);
    }
  });

  it("logs only bounded, non-secret counts on success, and logs nothing at all for a refused request", async () => {
    process.env[ENV_KEY] = SECRET;
    await mockRunBatch({ selected: 2, removed: 2, failed: 0 });
    const { GET } = await import("../app/api/internal/team-voice-cleanup/route");

    await GET(buildRequest(`Bearer ${"b".repeat(SECRET.length)}`));
    expect(logs).toHaveLength(0);

    await GET(buildRequest(`Bearer ${SECRET}`));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.event).toBe("system.team_voice_cleanup.completed");
    expect(logs[0]?.metadata).toEqual({ selected: 2, removed: 2, failed: 0 });
    expect(JSON.stringify(logs[0])).not.toContain(SECRET);
  });
});
