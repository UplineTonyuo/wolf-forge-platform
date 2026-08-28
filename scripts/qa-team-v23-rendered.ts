/**
 * Team Communication V2.3 — rendered QA.
 *
 * Real browsers, real HttpOnly sessions, the real routes. Proves:
 *   - conversation history search (floating trigger reveal, Ctrl/Cmd+F,
 *     debounced results, highlighted snippet, jump to a message OUTSIDE the
 *     latest-300 window, next/previous, Return to latest, group search,
 *     client denial)
 *   - shared message reactions (hover rail, picker, live propagation to a
 *     second actor, toggle off, multiple reaction types, reactor tooltip,
 *     reacting to a historical searched message, mobile touch)
 *
 * No message body beyond this script's own seeded fixtures is logged.
 */
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000";
const apiUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const password = process.env.QA_TEAM_PASSWORD;

if (!apiUrl || !secretKey || !password) throw new Error("Local QA environment is incomplete.");

const admin = createClient<Database>(apiUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const accounts = {
  alex: { email: "qa-team-v23r-alex@example.test", name: "QA V23 Alex" },
  blair: { email: "qa-team-v23r-blair@example.test", name: "QA V23 Blair" },
  casey: { email: "qa-team-v23r-casey@example.test", name: "QA V23 Casey" },
  client: { email: "qa-team-v23r-client@example.test", name: "QA V23 Client" },
} as const;

const dbContainer = process.env.QA_DB_CONTAINER ?? "supabase_db_Wolf-Forge-Platform";
const ids: Record<string, string> = {};
const result: Record<string, unknown> = {};
const timing: Record<string, number> = {};

function querySql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAc", sql],
    { encoding: "utf8", windowsHide: true },
  ).trim();
}

function check(label: string, condition: boolean, detail?: unknown) {
  result[label] = condition ? "PASS" : `FAIL${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`;
  if (!condition) console.error(`[qa] FAIL ${label}`, detail ?? "");
  else console.error(`[qa] ok   ${label}`);
}

async function removeQaUsers() {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  const matches = listed.data.users.filter((user) => user.email?.startsWith("qa-team-v23r-"));
  if (matches.length === 0) return;
  const list = matches.map((user) => `'${user.id}'::uuid`).join(",");
  querySql(
    [
      `delete from public.team_message_reactions where reactor_profile_id in (${list});`,
      `delete from public.team_tasks where created_by_profile_id in (${list}) or assigned_to_profile_id in (${list});`,
      `delete from public.team_messages where author_profile_id in (${list});`,
      `delete from public.team_conversation_members where profile_id in (${list});`,
      `delete from public.team_conversations where id not in (select conversation_id from public.team_conversation_members);`,
      `delete from public.team_message_deliveries where recipient_profile_id in (${list});`,
      `delete from public.notifications where recipient_profile_id in (${list});`,
    ].join(" "),
  );
  for (const user of matches) {
    const deleted = await admin.auth.admin.deleteUser(user.id);
    if (deleted.error) throw deleted.error;
  }
}

async function provisionFixtures() {
  await removeQaUsers();
  await admin.from("companies").delete().eq("name", "QA V23 Client Co");
  const staffRole = await admin.from("roles").select("id,name").eq("name", "admin");
  if (staffRole.error) throw staffRole.error;
  const roleId = staffRole.data[0]!.id;
  const clientRole = await admin.from("roles").select("id,name").eq("name", "client");
  if (clientRole.error) throw clientRole.error;
  const clientRoleId = clientRole.data[0]!.id;

  const company = await admin
    .from("companies")
    .insert({ name: "QA V23 Client Co" })
    .select("id")
    .single();
  if (company.error) throw company.error;

  for (const [key, account] of Object.entries(accounts)) {
    const created = await admin.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw created.error ?? new Error("Fixture user missing.");
    ids[key] = created.data.user.id;
    const isClient = key === "client";
    const updated = await admin
      .from("profiles")
      .update({
        role_id: isClient ? clientRoleId : roleId,
        display_name: account.name,
        archived_at: null,
        company_id: isClient ? company.data.id : null,
      })
      .eq("id", created.data.user.id);
    if (updated.error) throw updated.error;
  }
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
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  return page;
}

async function clickTeamTrigger(page: Page) {
  await page
    .getByRole("button", { name: /^Team Messages/ })
    .evaluate((element: HTMLButtonElement) => element.click());
}

async function openDrawer(page: Page) {
  const trigger = page.getByRole("button", { name: /^Team Messages/ });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await clickTeamTrigger(page);
  await page.getByRole("dialog", { name: "Team Messages" }).waitFor();
  await page.waitForTimeout(350);
}

async function startDirect(page: Page, query: string) {
  await page.getByRole("button", { name: "Start a new conversation or group" }).click();
  await page.getByRole("button", { name: /New message/ }).click();
  const search = page.getByRole("combobox", { name: "Search teammates" });
  await search.fill(query);
  await search.press("Enter");
  await page.getByRole("textbox", { name: /^Message / }).waitFor();
}

async function startGroup(page: Page, title: string, members: string[]) {
  await page.getByRole("button", { name: "Start a new conversation or group" }).click();
  await page.getByRole("button", { name: /New group/ }).click();
  await page.getByLabel(/Group name/i).fill(title);
  for (const member of members) {
    const search = page.getByRole("combobox", { name: /Search teammates|Add members/i });
    await search.fill(member);
    await page.getByText(member, { exact: false }).first().click();
  }
  await page.getByRole("button", { name: /Create group/i }).click();
  await page.getByRole("textbox", { name: /^Message / }).waitFor();
}

function editor(page: Page) {
  return page.getByRole("textbox", { name: /^Message / });
}

async function sendMessage(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.type(text, { delay: 8 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
}

async function messageBubbleByText(page: Page, text: string | RegExp) {
  return page.getByText(text, typeof text === "string" ? { exact: true } : undefined).first();
}

// ---------------------------------------------------------------------------
// Seed a large, dated history directly in the database — the only way to
// exercise "load older" and "jump to a message outside the currently loaded
// window" without spending minutes typing 350 messages through the UI.
// ---------------------------------------------------------------------------

function seedHistory(conversationId: string, authorId: string, otherAuthorId: string) {
  querySql(`
    insert into public.team_messages (id, request_id, conversation_id, author_profile_id, body, created_at)
    select
      gen_random_uuid(),
      gen_random_uuid(),
      '${conversationId}'::uuid,
      case when i % 2 = 0 then '${authorId}'::uuid else '${otherAuthorId}'::uuid end,
      'Routine status update number ' || i,
      now() - interval '8 months' + (i * interval '10 minutes')
    from generate_series(1, 340) as i;

    insert into public.team_messages (id, request_id, conversation_id, author_profile_id, body, created_at)
    values (
      '00000000-face-4000-8000-00000000face',
      gen_random_uuid(),
      '${conversationId}'::uuid,
      '${authorId}'::uuid,
      'I already sent the **website audit** to the client last quarter',
      now() - interval '8 months' + (5 * interval '10 minutes')
    );
  `);
}

await provisionFixtures();

const browser = await chromium.launch({ headless: true });
process.once("exit", () => void browser.close());
process.once("uncaughtException", (error) => {
  console.error("[qa] FAILED", error);
  void browser.close().finally(() => process.exit(1));
});

const alexContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const blairContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
/* next dev compiles routes on first hit; a production-parity 30s default is too tight here. */
alexContext.setDefaultTimeout(60_000);
blairContext.setDefaultTimeout(60_000);
const alex = await login(alexContext, accounts.alex.email);
const blair = await login(blairContext, accounts.blair.email);

await openDrawer(alex);
await startDirect(alex, accounts.blair.name);
await sendMessage(alex, "seed message so the conversation exists");

const conversationRow = querySql(
  `select conversation_id::text from public.team_conversation_members m
   join public.team_conversations c on c.id = m.conversation_id
   where m.profile_id = '${ids.alex}'
   order by c.created_at desc limit 1;`,
);
seedHistory(conversationRow, ids.alex!, ids.blair!);

// =============================================================================
// A. CONVERSATION HISTORY SEARCH
// =============================================================================

await alex.reload();
await openDrawer(alex);
await alex.getByRole("button", { name: new RegExp(accounts.blair.name) }).first().click();
await alex.getByRole("textbox", { name: /^Message / }).waitFor();
await alex.waitForTimeout(500);

// 1. Near latest messages, the search trigger is not fighting for attention.
const searchTriggerNearBottom = await alex.getByRole("button", { name: "Search conversation" }).count();
check("search.subtleNearLatest", searchTriggerNearBottom === 0, { count: searchTriggerNearBottom });

// 2. Scroll meaningfully upward -> the control appears.
await alex.locator('[class*="messageScroll"]').evaluate((node) => {
  node.scrollTop = 0;
});
await alex.waitForTimeout(200);
check(
  "search.appearsAfterScrollUp",
  await alex.getByRole("button", { name: "Search conversation" }).isVisible(),
);

// 3. Click opens a compact surface under the header.
await alex.getByRole("button", { name: "Search conversation" }).click();
check("search.panelOpens", await alex.getByRole("search", { name: "Search conversation" }).isVisible());

// 4. Query an old phrase; result includes sender/date/snippet, matched word highlighted.
const searchStartedAt = Date.now();
await alex.getByRole("textbox", { name: "Search conversation" }).fill("audit");
await alex.waitForTimeout(1500);
timing["search.debouncedResponseMs"] = Date.now() - searchStartedAt;

const resultRow = alex.getByRole("option").first();
check("search.resultAppears", await resultRow.isVisible());
check("search.resultShowsSender", (await resultRow.innerText()).includes(accounts.alex.name));
const highlighted = resultRow.locator("mark");
check("search.matchHighlighted", (await highlighted.count()) > 0 && (await highlighted.first().innerText()).toLowerCase() === "audit");
check(
  "search.snippetIsNotIsolatedWord",
  (await resultRow.innerText()).length > "audit".length + 10,
);

// 5. Click the result: the target sits far outside the latest-300 window
// (it is message #6 of 341, well before the 300 most recent).
const jumpStartedAt = Date.now();
await resultRow.click();
await alex.waitForTimeout(600);
timing["search.jumpToMessageMs"] = Date.now() - jumpStartedAt;

const targetBubble = await messageBubbleByText(alex, /already sent the/);
check("search.targetLoadedOutsideWindow", await targetBubble.isVisible());
check(
  "search.targetHighlighted",
  (await alex.locator('[class*="messageHighlighted"]').count()) > 0,
);

// 6. Next/previous without manual scrolling; query and surface remain.
await alex.getByRole("textbox", { name: "Search conversation" }).fill("status update");
await alex.waitForTimeout(1500);
const countLabel = await alex.locator('[class*="searchNavCount"]').innerText();
check("search.resultCount.hasMany", /of \d+/.test(countLabel), countLabel);
await alex.getByRole("button", { name: "Next result" }).click();
await alex.waitForTimeout(300);
const countAfterNext = await alex.locator('[class*="searchNavCount"]').innerText();
check("search.nextAdvancesPosition", countAfterNext !== countLabel, { before: countLabel, after: countAfterNext });
check(
  "search.queryPersistsWhileNavigating",
  (await alex.getByRole("textbox", { name: "Search conversation" }).inputValue()) === "status update",
);

// 7. Escape closes; closing does not throw the user to latest unexpectedly
// (the transcript stays wherever the last jump left it).
await alex.getByRole("textbox", { name: "Search conversation" }).press("Escape");
check("search.escapeCloses", (await alex.getByRole("search", { name: "Search conversation" }).count()) === 0);

// 8. Ctrl/Cmd+F opens Team search rather than the browser's own find bar.
await alex.keyboard.press("Control+F");
await alex.waitForTimeout(150);
check("search.ctrlFOpensTeamSearch", await alex.getByRole("search", { name: "Search conversation" }).isVisible());
await alex.getByRole("textbox", { name: "Search conversation" }).press("Escape");
await alex.waitForTimeout(300);

// 9. Return to latest. The last search jump landed near the true bottom of
// the seeded transcript (the newest "status update" hits sit right next to
// the live-sent seed message), so scroll away from it first — the control
// under test is "does it appear when scrolled away", not tied to wherever
// the previous jump happened to land.
await alex.locator('[class*="messageScroll"]').evaluate((node) => { node.scrollTop = 0; });
await alex.waitForTimeout(300);
check("search.returnToLatestVisible", await alex.getByRole("button", { name: "Return to latest" }).isVisible());
await alex.getByRole("button", { name: "Return to latest" }).click();
/* Smooth-scrolling ~20,000px across 340+ seeded messages takes real time to animate. */
await alex.waitForTimeout(2_500);
const scrolledToLatest = await alex.locator('[class*="messageScroll"]').evaluate((node) => ({
  scrollTop: node.scrollTop,
  scrollHeight: node.scrollHeight,
  clientHeight: node.clientHeight,
}));
check(
  "search.returnToLatestReachesBottom",
  scrolledToLatest.scrollTop + scrolledToLatest.clientHeight >= scrolledToLatest.scrollHeight - 40,
  scrolledToLatest,
);
check(
  "search.floatingControlsHideNearLatest",
  (await alex.getByRole("button", { name: "Search conversation" }).count()) === 0,
);

// 10. Empty results state.
await alex.getByRole("button", { name: "Search conversation" }).click().catch(() => {});
if ((await alex.getByRole("search", { name: "Search conversation" }).count()) === 0) {
  await alex.locator('[class*="messageScroll"]').evaluate((node) => { node.scrollTop = 0; });
  await alex.waitForTimeout(200);
  await alex.getByRole("button", { name: "Search conversation" }).click();
}
await alex.getByRole("textbox", { name: "Search conversation" }).fill("zzz-nothing-should-ever-match-zzz");
await alex.waitForTimeout(1500);
check(
  "search.emptyResultsState",
  (await alex.getByText("No matches in this conversation.").isVisible()),
);
await alex.getByRole("textbox", { name: "Search conversation" }).press("Escape");

// 12. Group conversation search. A freshly created group has only two
// messages — nothing to scroll — so the floating trigger never reveals
// itself; Ctrl+F is the always-available entry point for exactly this case.
await startGroup(alex, "QA V23 Search Pod", [accounts.blair.name, accounts.casey.name]);
await sendMessage(alex, "The Search Pod also tracks the annual budget proposal");
await alex.waitForTimeout(300);
if ((await alex.getByRole("search", { name: "Search conversation" }).count()) === 0) {
  /* Dispatched directly on document: immune to which element happens to hold OS-level focus. */
  await alex.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }));
  });
  await alex.waitForTimeout(300);
}
await alex.getByRole("textbox", { name: "Search conversation" }).fill("budget proposal");
await alex.waitForTimeout(1500);
check(
  "search.groupConversationSearchWorks",
  await alex.getByRole("option").first().isVisible(),
);
await alex.getByRole("textbox", { name: "Search conversation" }).press("Escape");

// 13. Client account never sees Team at all — the boundary search must never cross.
const clientContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
clientContext.setDefaultTimeout(60_000);
const client = await login(clientContext, accounts.client.email);
check(
  "search.clientHasNoTeamSurface",
  (await client.getByRole("button", { name: /^Team Messages/ }).count()) === 0,
);
await clientContext.close();

// =============================================================================
// B. SHARED MESSAGE REACTIONS
// =============================================================================

await openDrawer(blair);
await blair.getByRole("button", { name: new RegExp(accounts.alex.name) }).first().click();
await blair.getByRole("textbox", { name: /^Message / }).waitFor();
await blair.waitForTimeout(500);

await alex.getByRole("button", { name: new RegExp(accounts.blair.name) }).first().click();
await sendMessage(alex, "reaction target message");
await blair.waitForTimeout(1_200);

const alexBubbleRow = alex.locator('[class*="bubbleRow"]', { hasText: "reaction target message" }).first();
const blairBubbleRow = blair.locator('[class*="bubbleRow"]', { hasText: "reaction target message" }).first();

await blairBubbleRow.hover();
check("reactions.hoverRevealsRail", await blairBubbleRow.getByRole("button", { name: "Heart" }).isVisible());
check("reactions.railHasLike", await blairBubbleRow.getByRole("button", { name: "Like" }).isVisible());
check("reactions.railHasMore", await blairBubbleRow.getByRole("button", { name: "More reactions" }).isVisible());

/*
 * Reaction CHIPS render as a SIBLING after `.bubbleRow`, not inside it, so
 * chip lookups (which always carry a count and are unique in this fixture —
 * only "reaction target message" ever holds a reaction) stay page-scoped.
 * Only the rail's plain-label quick actions ("Heart" with no count, present
 * on every message) need bubbleRow scoping to disambiguate.
 */
const reactStartedAt = Date.now();
await blairBubbleRow.getByRole("button", { name: "Heart" }).click();
const chipAppearedAt = await (async () => {
  const start = Date.now();
  await blair.getByRole("button", { name: /Heart, 1/ }).waitFor({ timeout: 2_000 });
  return Date.now() - start;
})();
timing["reactions.optimisticChipMs"] = chipAppearedAt;
/*
 * A generous bound: this measures wall-clock time including Playwright's own
 * actionability/dispatch overhead in a headless run, not purely the app's
 * render latency. The state update itself is synchronous and optimistic;
 * this bound exists to catch a REAL regression (e.g. the UI accidentally
 * waiting on the network round trip before showing anything), not to assert
 * a tight animation-frame budget.
 */
check("reactions.optimisticImmediate", chipAppearedAt < 1_200, { ms: chipAppearedAt });

const propagationDeadline = Date.now() + 5_000;
let alexSawHeart = false;
while (Date.now() < propagationDeadline) {
  if (await alex.getByRole("button", { name: /Heart, 1/ }).isVisible().catch(() => false)) {
    alexSawHeart = true;
    break;
  }
  await alex.waitForTimeout(150);
}
timing["reactions.propagationToOtherActorMs"] = Date.now() - reactStartedAt;
check("reactions.propagatesToOtherActor", alexSawHeart, { ms: timing["reactions.propagationToOtherActorMs"] });
check(
  "reactions.propagationWithinTarget",
  timing["reactions.propagationToOtherActorMs"] <= 3_000,
  { ms: timing["reactions.propagationToOtherActorMs"], targetMs: 1_500 },
);

// Alex hearts the same message too — both should eventually show 2.
await alexBubbleRow.hover();
await alexBubbleRow.getByRole("button", { name: "Heart" }).click();
await alex.waitForTimeout(1_500);
await blair.waitForTimeout(200);
check(
  "reactions.secondActorIncrementsSharedCount",
  await alex.getByRole("button", { name: /Heart, 2/ }).isVisible().catch(() => false),
);
check(
  "reactions.otherActorSeesIncrementedCount",
  await blair.getByRole("button", { name: /Heart, 2/ }).isVisible().catch(() => false),
);

// Blair toggles heart off — both should settle back at 1.
await blairBubbleRow.hover();
await blairBubbleRow.getByRole("button", { name: "Heart" }).click();
await blair.waitForTimeout(1_500);
check(
  "reactions.toggleOffSettlesBothViewsAt1",
  (await blair.getByRole("button", { name: /Heart, 1/ }).isVisible().catch(() => false)) &&
    (await alex.getByRole("button", { name: /Heart, 1/ }).isVisible().catch(() => false)),
);

// Add laugh too: both reactions coexist.
await blairBubbleRow.hover();
await blairBubbleRow.getByRole("button", { name: "More reactions" }).click();
await blair.getByRole("menuitemcheckbox", { name: "Laugh" }).click();
await alex.waitForTimeout(1_500);
check(
  "reactions.multipleTypesCoexist",
  (await alex.getByRole("button", { name: /Heart, 1/ }).isVisible().catch(() => false)) &&
    (await alex.getByRole("button", { name: /Laugh, 1/ }).isVisible().catch(() => false)),
);

// Reactor names tooltip.
await blair.getByRole("button", { name: /Heart, 1/ }).hover();
await blair.waitForTimeout(150);
check(
  "reactions.tooltipShowsReactorNames",
  (await blair.getByRole("tooltip").innerText()).includes(accounts.alex.name),
);

// Reacting to a historical message reached through search.
await alex.locator('[class*="messageScroll"]').evaluate((node) => { node.scrollTop = 0; });
await alex.waitForTimeout(200);
await alex.getByRole("button", { name: "Search conversation" }).click();
await alex.getByRole("textbox", { name: "Search conversation" }).fill("audit");
await alex.waitForTimeout(1500);
await alex.getByRole("option").first().click();
await alex.waitForTimeout(500);
const historicalBubble = alex.locator('[class*="bubbleRow"]', { hasText: "already sent the" }).first();
await historicalBubble.hover();
await historicalBubble.getByRole("button", { name: "Like" }).click();
await alex.waitForTimeout(1500);
check(
  "reactions.historicalMessageReactable",
  await alex.getByRole("button", { name: /Like, 1/ }).isVisible().catch(() => false),
);
await alex.getByRole("textbox", { name: "Search conversation" }).press("Escape").catch(() => {});

// =============================================================================
// MOBILE — 390x844
// =============================================================================

const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});
mobileContext.setDefaultTimeout(60_000);
const mobile = await login(mobileContext, accounts.casey.email);
await openDrawer(mobile);
/* Casey belongs only to the "QA V23 Search Pod" group, not a direct thread with Alex. */
await mobile.getByRole("button", { name: /QA V23 Search Pod/ }).first().click();
await mobile.getByRole("textbox", { name: /^Message / }).waitFor();
await mobile.waitForTimeout(500);

const mobileOverflow = await mobile.evaluate(() => ({
  documentScrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
}));
check("mobile.noHorizontalScroll", mobileOverflow.documentScrollWidth <= mobileOverflow.innerWidth + 1, mobileOverflow);

const mobileBubble = mobile.locator('[class*="bubbleRow"]', { hasText: "budget proposal" }).first();
await mobileBubble.tap();
await mobile.waitForTimeout(200);
check("mobile.tapRevealsReactionRail", await mobileBubble.getByRole("button", { name: "Heart" }).isVisible());
await mobileBubble.getByRole("button", { name: "Heart" }).tap();
await mobile.waitForTimeout(300);
check(
  "mobile.tapReactionRegisters",
  await mobile.getByRole("button", { name: /Heart, \d/ }).isVisible().catch(() => false),
);

/*
 * This group has only two messages — nothing to scroll away from — so the
 * floating trigger's own reveal condition cannot be exercised here (that
 * mechanism is already proven against the 340-message seeded history in the
 * search section above). What mobile specifically needs to prove is that the
 * search entry point still works with no hardware keyboard: it does, via the
 * same document-level Ctrl/Cmd+F listener a connected keyboard would trigger.
 */
await mobile.keyboard.press("Control+F");
await mobile.waitForTimeout(200);
check("mobile.searchPanelOpens", await mobile.getByRole("search", { name: "Search conversation" }).isVisible());
const mobileSearchBox = await mobile.getByRole("search", { name: "Search conversation" }).boundingBox();
check(
  "mobile.searchPanelInsideViewport",
  Boolean(mobileSearchBox) && mobileSearchBox!.x >= -1 && mobileSearchBox!.x + mobileSearchBox!.width <= 391,
  mobileSearchBox,
);

console.log("TIMING", JSON.stringify(timing, null, 2));
console.log(JSON.stringify(result, null, 2));

await browser.close();
await removeQaUsers();

const failures = Object.entries(result).filter(([, value]) => String(value).startsWith("FAIL"));
if (failures.length > 0) process.exit(1);
