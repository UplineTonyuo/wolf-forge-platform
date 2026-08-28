/**
 * Hosted Preview QA — Team Communication V2.4 (message actions) + V2.5
 * (live-sync scheduler) against the real deployed Vercel Preview and real
 * hosted Supabase (jwynqsyirgenqlmkooah), using two REAL internal admin
 * accounts (no fixture provisioning, no service-role client, no admin API).
 *
 * Every scenario is driven entirely through the real app UI. A conversation
 * is located by a random per-run marker embedded in every message body sent
 * by this script, never by assuming either actor's display name, so this
 * cannot collide with or touch either actor's pre-existing conversations.
 *
 * The Preview has Vercel Deployment Protection (SSO) enabled, so every
 * browser request carries the automation bypass header.
 *
 * Required env: QA_BASE_URL, VERCEL_BYPASS_SECRET, QA_ACTOR_A_EMAIL,
 * QA_ACTOR_A_PASSWORD, QA_ACTOR_B_EMAIL, QA_ACTOR_B_PASSWORD.
 * No password is ever printed.
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page, type Request } from "playwright";

const baseUrl = process.env.QA_BASE_URL;
const bypassSecret = process.env.VERCEL_BYPASS_SECRET;
const emailA = process.env.QA_ACTOR_A_EMAIL;
const passwordA = process.env.QA_ACTOR_A_PASSWORD;
const emailB = process.env.QA_ACTOR_B_EMAIL;
const passwordB = process.env.QA_ACTOR_B_PASSWORD;

if (!baseUrl || !bypassSecret || !emailA || !passwordA || !emailB || !passwordB) {
  throw new Error("Hosted QA environment is incomplete.");
}

const MARKER = `wf-hosted-qa-${randomUUID().slice(0, 8)}`;
const checks: Record<string, string> = {};
const timing: Record<string, number> = {};
const counts: Record<string, number> = {};

function check(label: string, condition: boolean, detail?: unknown) {
  checks[label] = condition ? "PASS" : `FAIL${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`;
  console.error(condition ? `[qa] ok   ${label}` : `[qa] FAIL ${label}`);
}

async function newContext(browser: Awaited<ReturnType<typeof chromium.launch>>, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  await context.setExtraHTTPHeaders({ "x-vercel-protection-bypass": bypassSecret! });
  return context;
}

async function login(context: BrowserContext, email: string, password: string) {
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("PAGE_ERROR", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error("PAGE_CONSOLE", message.text());
  });
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.locator('input[name="password"]').fill(password);
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

// The original bubble, never a later reply's quoted preview of the same text.
function rowOriginal(page: Page, text: string | RegExp) {
  return page.locator('[class*="bubbleRow"]', { hasText: text }).first();
}

async function waitVisible(locator: ReturnType<typeof row>, timeout = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await locator.isVisible().catch(() => false)) return Date.now() - started;
    await locator.page().waitForTimeout(100);
  }
  return -1;
}

type TeamRouteHits = { "team-live": number; "team-sync": number; "team-typing": number };

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

async function waitForFirstRequest(tap: ReturnType<typeof tapRequests>, timeout: number) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (tap.total() > 0) return Date.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return -1;
}

async function findOtherConversationRow(page: Page, marker: string) {
  const rows = page.locator('[class*="conversationRow"]');
  const count = await rows.count();
  for (let i = 0; i < count; i += 1) {
    const text = await rows.nth(i).innerText().catch(() => "");
    if (text && !text.includes(marker)) return rows.nth(i);
  }
  return null;
}

const browser = await chromium.launch({ headless: true });
const alexContext = await newContext(browser, { width: 1440, height: 960 });
const blairContext = await newContext(browser, { width: 1440, height: 960 });
alexContext.setDefaultTimeout(60_000);
blairContext.setDefaultTimeout(60_000);

try {
  const alex = await login(alexContext, emailA, passwordA);
  const blair = await login(blairContext, emailB, passwordB);
  check("setup.actorALoggedIn", true);
  check("setup.actorBLoggedIn", true);

  // ---------------------------------------------------------------------
  // Establish a real direct conversation through the UI. Located by a
  // random marker only this run knows, so it can never collide with or
  // touch either actor's pre-existing conversations/messages.
  // ---------------------------------------------------------------------
  await openDrawer(alex);
  await alex.getByRole("button", { name: "Start a new conversation or group" }).click();
  const startDialog = alex.getByRole("dialog", { name: "Start a conversation" });
  await startDialog.getByRole("button", { name: /New message/i }).click();
  await startDialog.getByRole("combobox", { name: "Search teammates" }).fill(emailB);
  await startDialog.getByRole("option").filter({ hasText: emailB }).first().click();
  await alex.getByRole("textbox", { name: /^Message / }).waitFor({ timeout: 10_000 });
  await send(alex, `${MARKER} Hosted V2.4/V2.5 QA session start.`);
  check("setup.conversationCreated", true);

  await openDrawer(blair);
  const blairConvoRow = blair.getByRole("button", { name: new RegExp(MARKER) });
  await blairConvoRow.first().click({ timeout: 15_000 });
  await blair.getByRole("textbox", { name: /^Message / }).waitFor({ timeout: 10_000 });
  check("setup.actorBFoundConversation", true);

  // ---------------------------------------------------------------------
  // A. Active conversation: exchange messages, measure propagation + FAST
  //    cadence request volume.
  // ---------------------------------------------------------------------
  const activeTap = tapRequests(alex);
  const activeWindowStart = Date.now();
  const sendStarted = Date.now();
  await send(blair, `${MARKER} Active window message one.`);
  timing["active.optimisticMs"] = Date.now() - sendStarted;
  const activePropagation = await waitVisible(row(alex, "Active window message one."));
  timing["active.propagationMs"] = activePropagation;
  check("active.messagePropagates", activePropagation >= 0);
  check("active.propagationWithinTarget", activePropagation >= 0 && activePropagation <= 1_500, { activePropagation });
  await alex.waitForTimeout(6_000);
  counts["active.windowMs"] = Date.now() - activeWindowStart;
  counts["active.teamLiveRequests"] = activeTap.hits["team-live"];
  activeTap.detach();
  check("active.fastCadenceObserved", activeTap.hits["team-live"] >= 3, activeTap.hits);

  // ---------------------------------------------------------------------
  // B. V2.4 action rail: React, Reply, Delete for everyone — all on
  //    QA-created messages only.
  // ---------------------------------------------------------------------
  const targetRow = row(alex, "Active window message one.");
  await targetRow.hover();
  const reactStarted = Date.now();
  await targetRow.getByRole("button", { name: "React" }).click();
  await alex.getByRole("menu", { name: "Reactions" }).getByRole("menuitemcheckbox", { name: "Heart" }).click();
  const reactionPropagation = await waitVisible(blair.getByRole("button", { name: /Heart, 1/ }));
  timing["v24.reactionPropagationMs"] = reactionPropagation;
  check("v24.reactionPropagates", reactionPropagation >= 0 && reactionPropagation <= 1_500, { reactionPropagation, reactStarted });

  await targetRow.hover();
  const replyStarted = Date.now();
  await targetRow.getByRole("button", { name: "Reply" }).click();
  await send(alex, `${MARKER} Replying to my own message for QA.`);
  const replyPropagation = await waitVisible(row(blair, "Replying to my own message for QA."));
  timing["v24.replyPropagationMs"] = replyPropagation;
  check("v24.replyPropagates", replyPropagation >= 0 && replyPropagation <= 1_500, { replyPropagation, replyStarted });

  const deleteRow = rowOriginal(blair, "Active window message one.");
  await deleteRow.hover();
  const deleteStarted = Date.now();
  await deleteRow.getByRole("button", { name: "More" }).click();
  const actionsDialog = blair.getByRole("dialog", { name: "Message actions" });
  await actionsDialog.getByRole("button", { name: "Delete for everyone" }).click();
  await actionsDialog.getByRole("button", { name: "Delete" }).click();
  const deletePropagation = await waitVisible(alex.getByText(/message deleted/i).first());
  timing["v24.deletePropagationMs"] = deletePropagation;
  check("v24.deletePropagates", deletePropagation >= 0 && deletePropagation <= 1_500, { deletePropagation, deleteStarted });

  // ---------------------------------------------------------------------
  // C. Quiet-open request volume.
  // ---------------------------------------------------------------------
  await alex.waitForTimeout(21_000);
  const quietTap = tapRequests(alex);
  const quietWindowStart = Date.now();
  await alex.waitForTimeout(12_000);
  counts["quietOpen.windowMs"] = Date.now() - quietWindowStart;
  counts["quietOpen.teamLiveRequests"] = quietTap.hits["team-live"];
  quietTap.detach();
  check("quietOpen.cadenceSlowedFromFast", quietTap.hits["team-live"] <= 8, quietTap.hits);

  // ---------------------------------------------------------------------
  // D. Closed-drawer request volume + unread reconciliation.
  // ---------------------------------------------------------------------
  await closeDrawer(alex);
  const closedTap = tapRequests(alex);
  const closedWindowStart = Date.now();
  await send(blair, `${MARKER} Message sent while Alex has Team closed.`);
  await alex.waitForTimeout(31_000);
  counts["closed.windowMs"] = Date.now() - closedWindowStart;
  counts["closed.teamLiveRequests"] = closedTap.hits["team-live"];
  counts["closed.teamSyncRequests"] = closedTap.hits["team-sync"];
  closedTap.detach();
  check("closed.liveCadenceIsRare", closedTap.hits["team-live"] >= 0 && closedTap.hits["team-live"] <= 4, closedTap.hits);
  const badge = alex.getByRole("button", { name: /Team Messages, \d+ unread/ });
  check("closed.unreadStillReconciles", await badge.isVisible().catch(() => false));

  // ---------------------------------------------------------------------
  // E. Hidden-tab polling suppression + immediate wake on return.
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

  const visibleTap = tapRequests(alex);
  await alex.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const visibleWait = await waitForFirstRequest(visibleTap, 3_000);
  timing["hidden.immediateWakeMs"] = visibleWait;
  check("hidden.returnWakesImmediately", visibleWait >= 0 && visibleWait <= 1_500, { visibleWait });
  visibleTap.detach();

  // ---------------------------------------------------------------------
  // F. Offline / online.
  // ---------------------------------------------------------------------
  const offlineTap = tapRequests(alex);
  await alexContext.setOffline(true);
  await alex.waitForTimeout(8_000);
  counts["offline.teamLiveRequests"] = offlineTap.hits["team-live"];
  offlineTap.detach();
  check("offline.pollingPauses", offlineTap.total() === 0, offlineTap.hits);

  const onlineTap = tapRequests(alex);
  await alexContext.setOffline(false);
  const onlineWait = await waitForFirstRequest(onlineTap, 3_000);
  timing["offline.reconnectWakeMs"] = onlineWait;
  check("offline.reconnectWakesImmediately", onlineWait >= 0 && onlineWait <= 1_500, { onlineWait });
  onlineTap.detach();

  // ---------------------------------------------------------------------
  // G. Conversation switch (only if Actor A has another pre-existing
  //    conversation to switch to — a read-only view action, never sent to
  //    or deleted from).
  // ---------------------------------------------------------------------
  await openDrawer(alex);
  const other = await findOtherConversationRow(alex, MARKER);
  if (other) {
    const switchTap = tapRequests(alex);
    await other.click();
    const wake = await waitForFirstRequest(switchTap, 2_000);
    timing["conversationSwitch.wakeMs"] = wake;
    check("conversationSwitch.wakesImmediately", wake >= 0 && wake <= 1_500, { wake });
    switchTap.detach();
    const qaRow = alex.getByRole("button", { name: new RegExp(MARKER) });
    await qaRow.first().click();
    await alex.getByRole("textbox", { name: /^Message / }).waitFor();
  } else {
    check("conversationSwitch.skippedNoOtherConversation", true);
  }

  console.log("REQUEST_COUNTS", JSON.stringify(counts, null, 2));
  console.log("TIMING", JSON.stringify(timing, null, 2));
  console.log("CHECKS", JSON.stringify(checks, null, 2));
  const failures = Object.entries(checks).filter(([, value]) => value.startsWith("FAIL"));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
