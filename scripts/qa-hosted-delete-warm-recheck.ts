/**
 * Hosted Preview warm recheck — delete-for-everyone propagation timing,
 * run 3x against an already-warm Preview, plus a reply/reaction safety
 * check and a search-exclusion check on the first run.
 *
 * Same conventions as scripts/qa-hosted-preview-v24-v25.ts: no service-role
 * client, no fixture provisioning, two real hosted internal actors, target
 * conversation located by a random per-run marker so it can never touch
 * either actor's pre-existing conversations.
 *
 * Required env: QA_BASE_URL, VERCEL_BYPASS_SECRET, QA_ACTOR_A_EMAIL,
 * QA_ACTOR_A_PASSWORD, QA_ACTOR_B_EMAIL, QA_ACTOR_B_PASSWORD.
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";

const baseUrl = process.env.QA_BASE_URL;
const bypassSecret = process.env.VERCEL_BYPASS_SECRET;
const emailA = process.env.QA_ACTOR_A_EMAIL;
const passwordA = process.env.QA_ACTOR_A_PASSWORD;
const emailB = process.env.QA_ACTOR_B_EMAIL;
const passwordB = process.env.QA_ACTOR_B_PASSWORD;

if (!baseUrl || !bypassSecret || !emailA || !passwordA || !emailB || !passwordB) {
  throw new Error("Hosted QA environment is incomplete.");
}

const BASE_MARKER = `wf-del-recheck-${randomUUID().slice(0, 8)}`;
const checks: Record<string, string> = {};
const runs: Array<{ run: number; initiatorMs: number; remoteMs: number; tombstoneOk: boolean }> = [];

function check(label: string, condition: boolean, detail?: unknown) {
  checks[label] = condition ? "PASS" : `FAIL${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`;
  console.error(condition ? `[qa] ok   ${label}` : `[qa] FAIL ${label}`);
}

async function newContext(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
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

async function send(page: Page, body: string) {
  const editor = page.getByRole("textbox", { name: /^Message / });
  await editor.click();
  await page.keyboard.type(body, { delay: 4 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
}

function rowOriginal(page: Page, text: string | RegExp) {
  return page.locator('[class*="bubbleRow"]', { hasText: text }).first();
}

async function waitVisible(locator: ReturnType<typeof rowOriginal>, timeout = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await locator.isVisible().catch(() => false)) return Date.now() - started;
    await locator.page().waitForTimeout(100);
  }
  return -1;
}

const browser = await chromium.launch({ headless: true });
const aCtx = await newContext(browser);
const bCtx = await newContext(browser);
aCtx.setDefaultTimeout(60_000);
bCtx.setDefaultTimeout(60_000);

try {
  const a = await login(aCtx, emailA, passwordA);
  const b = await login(bCtx, emailB, passwordB);

  await openDrawer(a);
  await a.getByRole("button", { name: "Start a new conversation or group" }).click();
  const startDialog = a.getByRole("dialog", { name: "Start a conversation" });
  await startDialog.getByRole("button", { name: /New message/i }).click();
  await startDialog.getByRole("combobox", { name: "Search teammates" }).fill(emailB);
  await startDialog.getByRole("option").filter({ hasText: emailB }).first().click();
  await a.getByRole("textbox", { name: /^Message / }).waitFor({ timeout: 10_000 });
  await send(a, `${BASE_MARKER} warm recheck session start.`);

  await openDrawer(b);
  await b.getByRole("button", { name: new RegExp(BASE_MARKER) }).first().click({ timeout: 15_000 });
  await b.getByRole("textbox", { name: /^Message / }).waitFor({ timeout: 10_000 });
  check("setup.conversationReady", true);

  for (let i = 1; i <= 3; i += 1) {
    const runMarker = `${BASE_MARKER}-r${i}`;
    const bodyText = `${runMarker} delete warm recheck message.`;
    await send(a, bodyText);
    await waitVisible(rowOriginal(b, bodyText));

    if (i === 1) {
      // Reply/reference safety: attach a reply to run 1's message before deleting it.
      const bTarget = rowOriginal(b, bodyText);
      await bTarget.hover();
      await b.waitForTimeout(300);
      await bTarget.getByRole("button", { name: "Reply" }).click({ force: true });
      await send(b, `${runMarker} reply referencing the pre-delete message.`);
      await waitVisible(rowOriginal(a, `${runMarker} reply referencing`));
    }

    const deleteRow = rowOriginal(a, bodyText);
    await deleteRow.hover();
    await a.waitForTimeout(300);
    const started = Date.now();
    await deleteRow.getByRole("button", { name: "More" }).click({ force: true });
    const actionsDialog = a.getByRole("dialog", { name: "Message actions" });
    await actionsDialog.getByRole("button", { name: "Delete for everyone" }).click();
    await actionsDialog.getByRole("button", { name: "Delete" }).click();
    await actionsDialog.waitFor({ state: "hidden", timeout: 10_000 });
    const initiatorMs = Date.now() - started;

    const remoteMs = await waitVisible(b.getByText(/message deleted/i).first(), 10_000);
    const tombstoneOk = remoteMs >= 0;
    runs.push({ run: i, initiatorMs, remoteMs, tombstoneOk });
    check(`run${i}.tombstoneRendered`, tombstoneOk, { remoteMs });

    if (i === 1) {
      // Reply-reference safety: the reply itself must remain, showing the source as deleted, not vanish or corrupt.
      const replyStillPresent = await rowOriginal(b, `${runMarker} reply referencing`).isVisible().catch(() => false);
      check("run1.replyReferenceSurvivesSourceDelete", replyStillPresent);

      // Search exclusion: the deleted message's exact text must no longer be findable.
      await a.keyboard.press("Control+f");
      const searchInput = a.getByRole("textbox", { name: "Search conversation" });
      await searchInput.waitFor({ timeout: 5_000 });
      await searchInput.fill(bodyText);
      await a.waitForTimeout(500);
      const noMatches = await a.getByText("No matches in this conversation.").isVisible().catch(() => false);
      check("run1.deletedMessageExcludedFromSearch", noMatches);
      await a.keyboard.press("Escape");
    }
  }

  const timings = runs.map((r) => r.remoteMs);
  const sorted = [...timings].sort((x, y) => x - y);
  const median = sorted.length % 2 === 1
    ? sorted[(sorted.length - 1) / 2]
    : ((sorted[sorted.length / 2 - 1] ?? 0) + (sorted[sorted.length / 2] ?? 0)) / 2;
  const worst = Math.max(...timings);
  for (const r of runs) {
    check(`run${r.run}.propagationWithinTarget`, r.remoteMs >= 0 && r.remoteMs <= 1_500, { remoteMs: r.remoteMs });
  }

  console.log("RUNS", JSON.stringify(runs, null, 2));
  console.log("MEDIAN_MS", median);
  console.log("WORST_MS", worst);
  console.log("CHECKS", JSON.stringify(checks, null, 2));
  const failures = Object.entries(checks).filter(([, value]) => value.startsWith("FAIL"));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
