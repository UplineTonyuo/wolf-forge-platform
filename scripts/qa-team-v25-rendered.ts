/**
 * Team Communication V2.5 rendered QA — live-sync performance hardening.
 *
 * V2.5 is a transport/scheduling change only: an adaptive FAST/WARM/QUIET
 * scheduler replaces the fixed open/closed polling cadence V2.2-V2.4 used.
 * This script measures the thing a unit test cannot: REAL request counts
 * against the REAL `next dev` server and local Supabase, across the
 * scenarios the cost regression actually came from (an always-mounted
 * drawer polling at a fixed rate all day, regardless of activity).
 *
 * It intentionally does not re-check V2.4 product behavior (reactions,
 * reply, forward, delete, mobile action rail) — `qa-team-v24-rendered.ts`
 * already covers that in full and is re-run separately as the V2.5
 * regression gate. This script only adds what V2.5 introduces: tiered
 * cadence, hidden/offline pausing, and the resulting request-volume drop.
 *
 * Uses disposable LOCAL Supabase users and the real HttpOnly login flow. No
 * fixture message body is printed.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page, type Request } from "playwright";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000";
const apiUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const password = process.env.QA_TEAM_PASSWORD;
const dbContainer = process.env.QA_DB_CONTAINER ?? "supabase_db_Wolf-Forge-Platform";

if (!apiUrl || !secretKey || !password) throw new Error("Local QA environment is incomplete.");

const admin = createClient<Database>(apiUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const accounts = {
  alex: { email: "qa-team-v25-alex@example.test", name: "QA V25 Alex" },
  blair: { email: "qa-team-v25-blair@example.test", name: "QA V25 Blair" },
} as const;
const ids: Record<keyof typeof accounts, string> = { alex: "", blair: "" };
const directId = randomUUID();
const groupId = randomUUID();
const checks: Record<string, string> = {};
const timing: Record<string, number> = {};
const counts: Record<string, number> = {};

function check(label: string, condition: boolean, detail?: unknown) {
  checks[label] = condition ? "PASS" : `FAIL${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`;
  console.error(condition ? `[qa] ok   ${label}` : `[qa] FAIL ${label}`);
}

function sql(statement: string) {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAc", statement],
    { encoding: "utf8", windowsHide: true },
  ).trim();
}

async function cleanFixtures() {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  const users = listed.data.users.filter((user) => user.email?.startsWith("qa-team-v25-"));
  if (users.length) {
    const userIds = users.map((user) => `'${user.id}'::uuid`).join(",");
    sql(`
      delete from public.team_message_reactions where reactor_profile_id in (${userIds});
      delete from public.team_messages where author_profile_id in (${userIds})
         or conversation_id in (select conversation_id from public.team_conversation_members where profile_id in (${userIds}));
      delete from public.notifications where recipient_profile_id in (${userIds});
      delete from public.team_conversation_members where profile_id in (${userIds});
      delete from public.team_conversations where id not in (select conversation_id from public.team_conversation_members);
    `);
    for (const user of users) {
      const deleted = await admin.auth.admin.deleteUser(user.id);
      if (deleted.error) throw deleted.error;
    }
  }
}

async function provisionFixtures() {
  await cleanFixtures();
  const role = await admin.from("roles").select("id").eq("name", "admin").single();
  if (role.error) throw role.error;
  for (const [key, account] of Object.entries(accounts) as Array<[keyof typeof accounts, typeof accounts[keyof typeof accounts]]>) {
    const created = await admin.auth.admin.createUser({ email: account.email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("Missing fixture user.");
    ids[key] = created.data.user.id;
    const updated = await admin.from("profiles").update({
      display_name: account.name,
      role_id: role.data.id,
      company_id: null,
      archived_at: null,
    }).eq("id", created.data.user.id);
    if (updated.error) throw updated.error;
  }
}

function seedConversation() {
  const directKey = [ids.alex, ids.blair].sort().join("|");
  sql(`
    insert into public.team_conversations (id,conversation_key,created_by_profile_id,kind,title,last_message_at)
    values
      ('${directId}','${directKey}','${ids.alex}','direct',null,now()),
      ('${groupId}','group:${groupId}','${ids.alex}','group','QA V25 Second Room',now());
    insert into public.team_conversation_members (conversation_id,profile_id,last_read_at)
    values
      ('${directId}','${ids.alex}',now()),('${directId}','${ids.blair}',now()),
      ('${groupId}','${ids.alex}',now()),('${groupId}','${ids.blair}',now());
    insert into public.team_messages (id,request_id,conversation_id,author_profile_id,body,created_at)
    values
      (gen_random_uuid(),gen_random_uuid(),'${directId}','${ids.alex}','Starting the V2.5 performance pass.',now()),
      (gen_random_uuid(),gen_random_uuid(),'${groupId}','${ids.alex}','Second room seed message.',now());
  `);
}

async function login(context: BrowserContext, email: string) {
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("PAGE_ERROR", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error("PAGE_CONSOLE", message.text());
  });
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.locator('input[name="password"]').fill(password!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  return page;
}

async function openDrawer(page: Page) {
  const trigger = page.getByRole("button", { name: /^Team Messages/ });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.evaluate((node: HTMLButtonElement) => node.click());
  await page.getByRole("dialog", { name: "Team Messages" }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(300);
}

async function closeDrawer(page: Page) {
  const trigger = page.getByRole("button", { name: /^Team Messages/ });
  if ((await trigger.getAttribute("aria-expanded")) === "true") await trigger.evaluate((node: HTMLButtonElement) => node.click());
  await page.waitForTimeout(300);
}

async function send(page: Page, body: string) {
  const editor = page.getByRole("textbox", { name: /^Message / });
  await editor.click();
  await page.keyboard.type(body, { delay: 4 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
}

function row(page: Page, text: string | RegExp) {
  return page.locator('[class*="bubbleRow"]', { hasText: text }).last();
}

async function waitVisible(locator: ReturnType<typeof row>, timeout = 5_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await locator.isVisible().catch(() => false)) return Date.now() - started;
    await locator.page().waitForTimeout(100);
  }
  return -1;
}

type TeamRouteHits = { "team-live": number; "team-sync": number; "team-typing": number };

/** A live request-tap for one page, counting hits per Team route since it was attached. */
function tapRequests(page: Page) {
  const hits: TeamRouteHits = { "team-live": 0, "team-sync": 0, "team-typing": 0 };
  const handler = (request: Request) => {
    const url = request.url();
    if (url.includes("/api/team-live")) hits["team-live"] += 1;
    else if (url.includes("/api/team-sync")) hits["team-sync"] += 1;
    else if (url.includes("/api/team-typing")) hits["team-typing"] += 1;
  };
  page.on("request", handler);
  return {
    hits,
    total: () => hits["team-live"] + hits["team-sync"] + hits["team-typing"],
    detach: () => page.off("request", handler),
  };
}

/** Fixed intervals V2.2-V2.4 used, for the analytical BEFORE comparison. Not re-derived from source at runtime — recorded here from the code this replaced. */
const LEGACY = {
  liveOpenMs: 700,
  liveClosedMs: 1_200,
  backgroundOpenMs: 4_000,
  backgroundClosedMs: 15_000,
};
function legacyRequestsOverWindow(windowMs: number, liveMs: number, backgroundMs: number) {
  // +1 for the immediate request each lane fires the instant its cadence starts.
  return Math.floor(windowMs / liveMs) + 1 + Math.floor(windowMs / backgroundMs) + 1;
}

await provisionFixtures();
seedConversation();
const browser = await chromium.launch({ headless: true });
const alexContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const blairContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
alexContext.setDefaultTimeout(60_000);
blairContext.setDefaultTimeout(60_000);

try {
  const alex = await login(alexContext, accounts.alex.email);
  const blair = await login(blairContext, accounts.blair.email);

  await openDrawer(alex);
  await alex.getByRole("button", { name: new RegExp(accounts.blair.name) }).first().click();
  await row(alex, "Starting the V2.5 performance pass.").waitFor();

  await openDrawer(blair);
  await blair.getByRole("button", { name: new RegExp(accounts.alex.name) }).first().click();
  await blair.getByRole("textbox", { name: /^Message / }).waitFor();

  // ---------------------------------------------------------------------
  // A. Active conversation: exchange messages, confirm FAST-tier latency
  //    is unchanged from the V2.4 baseline, and count real requests.
  // ---------------------------------------------------------------------
  const activeTap = tapRequests(alex);
  const activeWindowStart = Date.now();
  const sendStarted = Date.now();
  await send(blair, "Active window message one.");
  timing["active.optimisticMs"] = Date.now() - sendStarted;
  const activePropagation = await waitVisible(row(alex, "Active window message one."));
  timing["active.propagationMs"] = activePropagation;
  check("active.messagePropagates", activePropagation >= 0);
  check(
    "active.propagationWithinTarget",
    activePropagation >= 0 && activePropagation <= 1_500,
    { activePropagation },
  );
  await alex.waitForTimeout(6_000); // hold inside the FAST window on both sides
  counts["active.windowMs"] = Date.now() - activeWindowStart;
  counts["active.teamLiveRequests"] = activeTap.hits["team-live"];
  activeTap.detach();
  check("active.fastCadenceObserved", activeTap.hits["team-live"] >= 5, activeTap.hits);

  // ---------------------------------------------------------------------
  // B. Quiet open conversation: let both sides go idle with the drawer
  //    still open long enough to decay past FAST and WARM into QUIET
  //    (fast-hold 5s + warm-hold 15s = 20s), then measure the settled rate.
  // ---------------------------------------------------------------------
  await alex.waitForTimeout(21_000); // clears the fast+warm hold window
  const quietTap = tapRequests(alex);
  const quietWindowStart = Date.now();
  await alex.waitForTimeout(12_000);
  counts["quietOpen.windowMs"] = Date.now() - quietWindowStart;
  counts["quietOpen.teamLiveRequests"] = quietTap.hits["team-live"];
  quietTap.detach();
  // At the ~2s quiet cadence a 12s window holds ~6 ticks; comfortably fewer
  // than the ~17 the FAST cadence would have produced over the same window.
  check("quietOpen.cadenceSlowedFromFast", quietTap.hits["team-live"] <= 8, quietTap.hits);

  // ---------------------------------------------------------------------
  // D. Activity after a quiet period snaps straight back to FAST — a
  //    message sent right after the quiet window must still arrive fast.
  // ---------------------------------------------------------------------
  const afterQuietStarted = Date.now();
  await send(alex, "Reviving the conversation after a quiet period.");
  timing["afterQuiet.optimisticMs"] = Date.now() - afterQuietStarted;
  const afterQuietPropagation = await waitVisible(row(blair, "Reviving the conversation after a quiet period."));
  timing["afterQuiet.propagationMs"] = afterQuietPropagation;
  check("afterQuiet.propagatesFast", afterQuietPropagation >= 0 && afterQuietPropagation <= 1_500, { afterQuietPropagation });

  // ---------------------------------------------------------------------
  // C. Team drawer closed: no conversation visible at all. Both lanes
  //    should still tick, just far less often, and unread must still work.
  // ---------------------------------------------------------------------
  await closeDrawer(alex);
  const closedTap = tapRequests(alex);
  const closedWindowStart = Date.now();
  await send(blair, "Message sent while Alex has Team closed.");
  await alex.waitForTimeout(31_000); // long enough to see the closed-tier live cadence tick at least twice
  counts["closed.windowMs"] = Date.now() - closedWindowStart;
  counts["closed.teamLiveRequests"] = closedTap.hits["team-live"];
  counts["closed.teamSyncRequests"] = closedTap.hits["team-sync"];
  closedTap.detach();
  check(
    "closed.liveCadenceIsRare",
    closedTap.hits["team-live"] >= 1 && closedTap.hits["team-live"] <= 4,
    closedTap.hits,
  );
  const badge = alex.getByRole("button", { name: /Team Messages, \d+ unread/ });
  check("closed.unreadStillReconciles", await badge.isVisible().catch(() => false));

  // ---------------------------------------------------------------------
  // Hidden tab: simulate `document.visibilityState !== "visible"` the way
  // the app itself observes it, since a headless single-window context has
  // no OS-level tab-backgrounding signal to trigger otherwise.
  // ---------------------------------------------------------------------
  await openDrawer(alex);
  await alex.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenTap = tapRequests(alex);
  await alex.waitForTimeout(15_000);
  counts["hidden.windowMs"] = 15_000;
  counts["hidden.teamLiveRequests"] = hiddenTap.hits["team-live"];
  counts["hidden.teamSyncRequests"] = hiddenTap.hits["team-sync"];
  hiddenTap.detach();
  check("hidden.noPolling", hiddenTap.total() === 0, hiddenTap.hits);

  // Returning visible must reconcile immediately, not wait for a timer.
  const visibleTap = tapRequests(alex);
  await alex.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const visibleWait = await (async () => {
    const started = Date.now();
    while (Date.now() - started < 3_000) {
      if (visibleTap.total() > 0) return Date.now() - started;
      await alex.waitForTimeout(50);
    }
    return -1;
  })();
  timing["hidden.immediateWakeMs"] = visibleWait;
  check("hidden.returnWakesImmediately", visibleWait >= 0 && visibleWait <= 1_000, { visibleWait });
  visibleTap.detach();

  // ---------------------------------------------------------------------
  // I. Conversation switch wakes immediately (no waiting for the next
  //    scheduled tick, even from a quiet/closed rate). Switches between the
  //    two REAL seeded conversations directly from the desktop list pane —
  //    "Back to conversations" is a mobile-only control and must not be
  //    relied on at the 1440x960 desktop viewport this context uses.
  // ---------------------------------------------------------------------
  await blair.getByRole("button", { name: "QA V25 Second Room" }).first().click();
  await blair.getByRole("textbox", { name: /^Message / }).waitFor();
  const switchTap = tapRequests(blair);
  const switchStarted = Date.now();
  await blair.getByRole("button", { name: new RegExp(accounts.alex.name) }).first().click();
  const switchWait = await (async () => {
    const started = Date.now();
    while (Date.now() - started < 2_000) {
      if (switchTap.hits["team-live"] > 0) return Date.now() - started;
      await blair.waitForTimeout(50);
    }
    return -1;
  })();
  timing["conversationSwitch.wakeMs"] = switchWait;
  check("conversationSwitch.wakesImmediately", switchWait >= 0 && switchWait <= 1_000, { switchStarted, switchWait });
  switchTap.detach();
  await blair.getByRole("textbox", { name: /^Message / }).waitFor();

  // ---------------------------------------------------------------------
  // E-H. Reaction / reply / delete quality spot-check (full coverage is
  // qa-team-v24-rendered.ts, re-run separately as the V2.5 regression gate).
  // ---------------------------------------------------------------------
  const spotRow = row(alex, "Active window message one.");
  await spotRow.hover();
  const spotStarted = Date.now();
  await spotRow.getByRole("button", { name: "React" }).click();
  await alex.getByRole("menu", { name: "Reactions" }).getByRole("menuitemcheckbox", { name: "Heart" }).click();
  const reactionSpotPropagation = await waitVisible(blair.getByRole("button", { name: /Heart, 1/ }));
  timing["spot.reactionPropagationMs"] = reactionSpotPropagation;
  check("spot.reactionStillFast", reactionSpotPropagation >= 0 && reactionSpotPropagation <= 1_500, { reactionSpotPropagation, spotStarted });

  // ---------------------------------------------------------------------
  // K. Mobile viewport: request volume and no-overflow, quick touch.
  // ---------------------------------------------------------------------
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  mobileContext.setDefaultTimeout(60_000);
  const mobile = await login(mobileContext, accounts.blair.email);
  await openDrawer(mobile);
  await mobile.getByRole("button", { name: new RegExp(accounts.alex.name) }).first().click();
  await mobile.getByRole("textbox", { name: /^Message / }).waitFor();
  const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check("mobile.noHorizontalOverflow", !mobileOverflow);
  const mobileTap = tapRequests(mobile);
  await mobile.waitForTimeout(4_000);
  check("mobile.fastCadenceWhileActive", mobileTap.hits["team-live"] >= 3, mobileTap.hits);
  mobileTap.detach();
  await mobileContext.close();

  // ---------------------------------------------------------------------
  // Analytical BEFORE comparison (not re-measured against reverted code —
  // the legacy constants are fixed and undisputed, so the legacy request
  // count over an identical wall-clock window is exact arithmetic, not an
  // estimate).
  // ---------------------------------------------------------------------
  const legacyActive = legacyRequestsOverWindow(counts["active.windowMs"], LEGACY.liveOpenMs, LEGACY.backgroundOpenMs);
  const legacyClosed = legacyRequestsOverWindow(counts["closed.windowMs"], LEGACY.liveClosedMs, LEGACY.backgroundClosedMs);
  const legacyHidden = legacyRequestsOverWindow(counts["hidden.windowMs"], LEGACY.liveOpenMs, LEGACY.backgroundOpenMs); // hidden while a conversation was open pre-V2.5 too, but pre-V2.5 already skipped hidden ticks — see report
  const measuredClosedTotal = closedTap.hits["team-live"] + closedTap.hits["team-sync"];
  const legacyClosedLiveOnly = Math.floor(counts["closed.windowMs"] / LEGACY.liveClosedMs) + 1;
  const legacyQuietOpenLiveOnly = Math.floor(counts["quietOpen.windowMs"] / LEGACY.liveOpenMs) + 1;

  console.log("REQUEST_COUNTS", JSON.stringify({
    active: { measuredLive: counts["active.teamLiveRequests"], windowMs: counts["active.windowMs"] },
    quietOpen: {
      measuredLive: counts["quietOpen.teamLiveRequests"],
      legacyLive: legacyQuietOpenLiveOnly,
      windowMs: counts["quietOpen.windowMs"],
    },
    closed: {
      measuredLive: closedTap.hits["team-live"],
      measuredSync: closedTap.hits["team-sync"],
      measuredTotal: measuredClosedTotal,
      legacyLive: legacyClosedLiveOnly,
      legacyTotal: legacyClosed,
      windowMs: counts["closed.windowMs"],
    },
    hidden: { measuredTotal: hiddenTap.total(), legacyTotalHadHiddenExisted: legacyHidden, windowMs: counts["hidden.windowMs"] },
  }, null, 2));
  const closedReductionPct = Math.round((1 - measuredClosedTotal / legacyClosed) * 100);
  const quietOpenReductionPct = Math.round((1 - counts["quietOpen.teamLiveRequests"] / legacyQuietOpenLiveOnly) * 100);
  check("closed.reductionMeetsGate", closedReductionPct >= 80, { closedReductionPct, measuredClosedTotal, legacyClosed });
  timing["closed.reductionPct"] = closedReductionPct;
  timing["quietOpen.reductionPct"] = quietOpenReductionPct;
  void legacyActive;

  console.log("TIMING", JSON.stringify(timing));
  console.log("CHECKS", JSON.stringify(checks));
  const failures = Object.entries(checks).filter(([, value]) => value.startsWith("FAIL"));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
  await cleanFixtures();
}
