import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

/**
 * Operations V2 posture pins, mirroring how `security-monitoring.test.ts`
 * pins the Gmail/Team boundaries by reading source rather than re-deriving
 * behavior at runtime — the failure mode here (a write scope quietly added,
 * a `team_tasks` reference sneaking in, a customer field leaking into a log
 * call) is exactly the kind of thing that "the tests still pass" would not
 * otherwise catch.
 */
describe("Google Sheets adapter remains read-only", () => {
  const source = read("lib/integrations/google-sheets-source.ts");

  it("requests only the readonly Sheets scope, never the read-write one", () => {
    expect(source).toContain("https://www.googleapis.com/auth/spreadsheets.readonly");
    expect(source).not.toContain('"https://www.googleapis.com/auth/spreadsheets"');
  });

  it("never calls a Sheets write/append/delete/update endpoint", () => {
    expect(source).not.toMatch(/:batchUpdate|:append|method:\s*["'](PUT|PATCH|DELETE)["']/);
  });

  it("the sync webhook route never calls the Sheets API directly — it only invalidates a cache tag", () => {
    const route = read("app/api/operations/podcast-seo/sync/route.ts");
    expect(route).not.toContain("sheets.googleapis.com");
    expect(route).not.toContain("UrlFetchApp");
    expect(route).toContain("revalidateTag");
  });
});

describe("Podcast SEO data never touches team_tasks", () => {
  const podcastFiles = [
    "domain/operations/podcast-workflow.ts",
    "domain/operations/podcast-sync-webhook.ts",
    "services/podcast-workflow-service.ts",
    "lib/integrations/google-sheets-source.ts",
    "lib/integrations/podcast-sync-version.ts",
    "lib/security/podcast-sync-guard.ts",
    "lib/security/operations-webhook-hmac.ts",
    "app/api/operations/podcast-seo/sync/route.ts",
    "app/api/operations/podcast-seo/version/route.ts",
    "app/api/operations/podcast-seo/snapshot/route.ts",
    "components/operations/podcast-seo-workflow-view.tsx",
    "components/operations/podcast-seo-live-view.tsx",
    "components/operations/use-podcast-live-sync.ts",
  ];

  for (const file of podcastFiles) {
    it(`${file} never queries or writes the team_tasks table`, () => {
      /*
       * Matches real usage (`.from("team_tasks")`, `.team_tasks(...)`, a bare
       * quoted table-name argument) but not the deliberate boundary note in
       * `podcast-workflow.ts`'s own doc comment ("never mirrored into
       * team_tasks") — that comment is the boundary being asserted, not a
       * violation of it.
       */
      expect(read(file)).not.toMatch(/\.from\(\s*["']team_tasks["']\s*\)|\.team_tasks\s*\(/);
    });
  }
});

describe("The Podcast SEO sync webhook carries no workflow or customer data", () => {
  const route = read("app/api/operations/podcast-seo/sync/route.ts");
  const appsScript = read("../scripts/apps-script/podcast-seo-sync.gs.js");

  it("the webhook payload schema's actual field set is exactly eventType/timestamp/nonce", async () => {
    /*
     * The structural check (not a prose/comment scan, which would false-positive
     * on this very file's own "never sends emails" explanation): the zod
     * schema's real `.shape` keys, already asserted in
     * `podcast-sync-webhook-domain.test.ts`, re-asserted here as the load-bearing
     * claim this whole describe block depends on.
     */
    const { podcastSyncWebhookShapeSchema } = await import("../domain/operations/podcast-sync-webhook");
    expect(Object.keys(podcastSyncWebhookShapeSchema.shape).sort()).toEqual([
      "eventType",
      "nonce",
      "timestamp",
    ]);
  });

  it("the route never reads a spreadsheet id, row values, or sheet contents from the request", () => {
    expect(route).not.toContain("PODCAST_SEO_SPREADSHEET_ID");
    expect(route).not.toMatch(/\brows\b/);
    expect(route).not.toContain("fetchLatestPodcastTab");
  });

  it("the route's own rejection/acceptance logs carry only a fixed reason token or the fixed event type, never request content", () => {
    const events = route.match(/recordSecurityEvent\(\{[\s\S]*?\n\s*\}\);/g) ?? [];
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event).not.toMatch(/shape\.data|parsedJson|rawBody/);
    }
  });

  it("the Apps Script source only ever sends eventType/timestamp/nonce, and reads no cell values into the payload", () => {
    expect(appsScript).toContain("eventType:");
    expect(appsScript).toContain("timestamp:");
    expect(appsScript).toContain("nonce:");
    expect(appsScript).not.toMatch(/getRange\(.*getValue|getDisplayValues|getValues\(\)/);
    expect(appsScript).not.toContain("e.value");
    expect(appsScript).not.toContain("e.oldValue");
  });

  it("the Apps Script secret and URL are read from Script Properties, never hard-coded", () => {
    expect(appsScript).toContain("PropertiesService.getScriptProperties()");
    expect(appsScript).not.toMatch(/https:\/\/[^\s"']*vercel\.app/);
  });
});

describe("The webhook is the one route exempt from the session boundary, and only that route", () => {
  it("the sync route never calls the session/internal-actor resolvers", () => {
    const route = read("app/api/operations/podcast-seo/sync/route.ts");
    expect(route).not.toContain("getInternalContext");
    expect(route).not.toContain("getInternalActorContext");
    expect(route).not.toContain("requestIsSameOrigin");
  });

  it("the version and snapshot routes both require the full internal-actor check", () => {
    /*
     * Deliberately NOT asserting `requestIsSameOrigin` here — it was removed
     * from both routes. Browsers omit the `Origin` header on a same-origin
     * GET fetch (only non-GET/HEAD methods get it per the Fetch spec), so
     * that check refused every real poll and refetch with a 403 and was the
     * root cause of realtime sync never firing. `getInternalActorContext()`
     * is the real, sufficient boundary for a side-effect-free read.
     */
    for (const file of [
      "app/api/operations/podcast-seo/version/route.ts",
      "app/api/operations/podcast-seo/snapshot/route.ts",
    ]) {
      const source = read(file);
      expect(source).toContain("getInternalActorContext");
      /* A doc comment explaining WHY the check was removed is fine and expected; an actual import or call is not. */
      expect(source).not.toMatch(/requestIsSameOrigin\(|from ".*same-origin"/);
    }
  });

  it("no browser-facing module reads the Supabase session's access token or exposes it as a prop", () => {
    for (const file of [
      "components/operations/use-podcast-live-sync.ts",
      "components/operations/podcast-seo-live-view.tsx",
    ]) {
      const source = read(file);
      expect(source).not.toMatch(/access_token|session\.token|getSession/);
    }
  });
});
