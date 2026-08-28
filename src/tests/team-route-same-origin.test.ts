import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PermissionDeniedError,
  ValidationError,
} from "../lib/errors/application-error";
import { requestIsSameOrigin } from "../lib/security/same-origin";
import { setSecurityAuditSink } from "../lib/security/security-audit-log";
import { recordTeamRouteRefusal } from "../lib/security/team-route-refusal";
import type { SecurityAuditRow } from "../domain/security/audit";

function build(headers: Record<string, string>) {
  // The URL is deliberately the localhost form Next normalizes to, which is
  // what made the previous request.url comparison refuse genuine callers.
  return new Request("http://localhost:3100/api/team-sync", {
    method: "POST",
    headers,
  });
}

describe("Team route payload and throttle responses", () => {
  const root = resolve(import.meta.dirname, "..");
  const routes: Array<[string, string]> = [
    ["app/api/team-live/route.ts", "8 * 1024"],
    ["app/api/team-sync/route.ts", "4 * 1024"],
    ["app/api/team-typing/route.ts", "4 * 1024"],
    ["app/api/team-presence/disconnect/route.ts", "2 * 1024"],
  ];

  it("stream-bounds every JSON body before session or Team database work", () => {
    for (const [path, bound] of routes) {
      const source = readFileSync(resolve(root, path), "utf8");
      const bounded = source.indexOf(`readBoundedJson(request, ${bound})`);
      expect(bounded, path).toBeGreaterThan(-1);
      expect(source, path).not.toContain("request.json()");
      expect(bounded, path).toBeLessThan(source.indexOf("getTeamActorContext()"));
    }
  });

  it("uses HTTP 429 when a Team RPC reports its durable rate limit", () => {
    for (const path of routes.slice(0, 3).map(([value]) => value)) {
      const source = readFileSync(resolve(root, path), "utf8");
      expect(source, path).toContain('safe.code === "RATE_LIMITED" ? 429 : 400');
    }
  });
});

describe("Team route same-origin guard", () => {
  it("accepts a browser call whose Host is not the normalized localhost URL", () => {
    expect(
      requestIsSameOrigin(
        build({ host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" }),
      ),
    ).toBe(true);
  });

  it("accepts an https call behind a TLS-terminating proxy", () => {
    expect(
      requestIsSameOrigin(
        build({
          host: "wolf-forge.vercel.app",
          "x-forwarded-proto": "https",
          origin: "https://wolf-forge.vercel.app",
        }),
      ),
    ).toBe(true);
  });

  it("accepts the forwarded host when it is the public one", () => {
    expect(
      requestIsSameOrigin(
        build({
          host: "internal.local",
          "x-forwarded-host": "wolf-forge.vercel.app",
          "x-forwarded-proto": "https",
          origin: "https://wolf-forge.vercel.app",
        }),
      ),
    ).toBe(true);
  });

  it("refuses a cross-origin browser call", () => {
    expect(
      requestIsSameOrigin(
        build({ host: "127.0.0.1:3100", origin: "https://evil.example" }),
      ),
    ).toBe(false);
  });

  it("refuses a call with no Origin at all", () => {
    expect(requestIsSameOrigin(build({ host: "127.0.0.1:3100" }))).toBe(false);
  });

  it("refuses a scheme downgrade against a forwarded https request", () => {
    expect(
      requestIsSameOrigin(
        build({
          host: "wolf-forge.vercel.app",
          "x-forwarded-proto": "https",
          origin: "http://wolf-forge.vercel.app",
        }),
      ),
    ).toBe(false);
  });

  it("refuses a malformed Origin", () => {
    expect(
      requestIsSameOrigin(build({ host: "127.0.0.1:3100", origin: "not-a-url" })),
    ).toBe(false);
  });
});

/**
 * The Team routes resolve only a verified actor now — the profile, role,
 * permission and module reads that decide what a PAGE renders decide nothing
 * for a route that renders nothing, and cost a wave of round trips on the
 * latency path. The audit event those reads used to produce has to survive that
 * change, because a client account POSTing to an internal route is exactly the
 * cross-surface attempt the taxonomy exists to record.
 */
describe("Team route refusal audit", () => {
  const actorId = "11111111-1111-4111-8111-111111111111";

  async function capture(error: unknown) {
    const rows: SecurityAuditRow[] = [];
    setSecurityAuditSink(async (row) => {
      rows.push(row);
    });
    try {
      await recordTeamRouteRefusal({ error, actorId, surface: "team.live" });
    } finally {
      setSecurityAuditSink(null);
    }
    return rows;
  }

  it("records the refusal the database decided", async () => {
    const rows = await capture(new PermissionDeniedError());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_code).toBe("authorization.context.denied");
    expect(rows[0]?.actor_profile_id).toBe(actorId);
    expect(rows[0]?.outcome).toBe("denied");
  });

  it("stays silent for an ordinary failure, which is not an attempt at anything", async () => {
    expect(await capture(new ValidationError("bad shape"))).toHaveLength(0);
    expect(await capture(new Error("network"))).toHaveLength(0);
  });

  it("never carries anything about the message itself", async () => {
    const rows = await capture(new PermissionDeniedError());
    expect(JSON.stringify(rows[0]?.metadata)).toBe(
      JSON.stringify({ surface: "team.live", reason: "not_team_actor" }),
    );
  });
});
