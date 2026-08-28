/**
 * Hosted Preview — live CLIENT-role isolation check for Team Communication.
 *
 * Logs in as a real hosted CLIENT account and verifies, against the actual
 * running Preview (not a static read): the Team Messages trigger is absent
 * from the shell, and the two directly-callable Team API routes
 * (/api/team-live, /api/team-sync) return a genuine server-side denial, not
 * merely an empty result. Makes no mutation and does not touch the client
 * account's role, permissions, company assignment, profile, or business
 * data.
 *
 * Required env: QA_BASE_URL, VERCEL_BYPASS_SECRET, QA_CLIENT_EMAIL,
 * QA_CLIENT_PASSWORD.
 */
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL;
const bypassSecret = process.env.VERCEL_BYPASS_SECRET;
const clientEmail = process.env.QA_CLIENT_EMAIL;
const clientPassword = process.env.QA_CLIENT_PASSWORD;

if (!baseUrl || !bypassSecret || !clientEmail || !clientPassword) {
  throw new Error("Client isolation QA environment is incomplete.");
}

const checks: Record<string, string> = {};
const details: Record<string, unknown> = {};

function check(label: string, condition: boolean, detail?: unknown) {
  checks[label] = condition ? "PASS" : `FAIL${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`;
  if (detail !== undefined) details[label] = detail;
  console.error(condition ? `[qa] ok   ${label}` : `[qa] FAIL ${label}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
await context.setExtraHTTPHeaders({ "x-vercel-protection-bypass": bypassSecret });
context.setDefaultTimeout(30_000);

try {
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("PAGE_ERROR", error.message));

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(clientEmail);
  await page.locator('input[name="password"]').fill(clientPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  check("client.loggedIn", true, { finalUrl: page.url() });

  // 1. Team Messages nav/trigger must not be server-rendered for a client actor.
  await page.waitForTimeout(1_000);
  const teamTriggerVisible = await page.getByRole("button", { name: /^Team Messages/ }).isVisible().catch(() => false);
  check("client.teamNavHidden", !teamTriggerVisible, { teamTriggerVisible });

  // 2. Direct API request — /api/team-live, with a SCHEMA-VALID body so the
  //    request actually reaches the actor-authorization gate rather than
  //    being rejected by input validation before any auth check runs.
  const liveResult = await page.evaluate(async () => {
    const response = await fetch("/api/team-live", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: null, since: null }),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  });
  check(
    "client.teamLiveApiDenied",
    liveResult.status === 401 || liveResult.status === 403 || (liveResult.status === 400 && liveResult.body?.error !== "Invalid Team request."),
    liveResult,
  );

  // 3. Direct API request — /api/team-sync, schema-valid body.
  const syncResult = await page.evaluate(async () => {
    const response = await fetch("/api/team-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        includeConversations: true,
        includeTasks: true,
        includeTeamTasks: true,
        includeMembers: true,
        materializeDigests: false,
      }),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  });
  check(
    "client.teamSyncApiDenied",
    syncResult.status === 401 || syncResult.status === 403 || (syncResult.status === 400 && syncResult.body?.error !== "Invalid Team sync request."),
    syncResult,
  );

  // 4. Direct API request — /api/team-typing, schema-valid body with a
  //    random (non-existent) conversation/connection id.
  const typingResult = await page.evaluate(async (payload) => {
    const response = await fetch("/api/team-typing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  }, { conversationId: randomUUID(), connectionId: randomUUID(), operation: "touch" });
  check(
    "client.teamTypingApiDenied",
    typingResult.status === 401 || typingResult.status === 403 || (typingResult.status === 400 && typingResult.body?.error !== "Invalid typing request."),
    typingResult,
  );

  console.log("CHECKS", JSON.stringify(checks, null, 2));
  console.log("DETAILS", JSON.stringify(details, null, 2));
  const failures = Object.entries(checks).filter(([, value]) => value.startsWith("FAIL"));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
