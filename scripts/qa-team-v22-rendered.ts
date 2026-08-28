/**
 * Team Communication V2.2 — rendered QA.
 *
 * Two real browsers, real HttpOnly sessions, the real routes. This is where the
 * rich composer is actually proven: a contenteditable is a browser object, and
 * jsdom cannot represent selection, caret or list toggling honestly, so the
 * unit suite asserts the serialization contract and this asserts the behaviour.
 *
 * No message body is logged. Assertions compare against fixtures this script
 * itself wrote.
 */
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:3100";
const apiUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const password = process.env.QA_TEAM_PASSWORD;

if (!apiUrl || !secretKey || !password) throw new Error("Local QA environment is incomplete.");

const admin = createClient<Database>(apiUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const accounts = {
  alex: { email: "qa-team-v22r-alex@example.test", name: "QA V22 Alex" },
  blair: { email: "qa-team-v22r-blair@example.test", name: "QA V22 Blair" },
} as const;

const dbContainer = process.env.QA_DB_CONTAINER ?? "supabase_db_Wolf-Forge-Platform";
const ids: Record<string, string> = {};
const result: Record<string, unknown> = {};

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
  const matches = listed.data.users.filter((user) => user.email?.startsWith("qa-team-v22r-"));
  if (matches.length === 0) return;
  const list = matches.map((user) => `'${user.id}'::uuid`).join(",");
  querySql(
    [
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
  const roles = await admin.from("roles").select("id,name").eq("name", "admin");
  if (roles.error) throw roles.error;
  const roleId = roles.data[0]!.id;

  for (const [key, account] of Object.entries(accounts)) {
    const created = await admin.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw created.error ?? new Error("Fixture user missing.");
    ids[key] = created.data.user.id;
    const updated = await admin
      .from("profiles")
      .update({ role_id: roleId, display_name: account.name, archived_at: null, company_id: null })
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

/** The trigger sits under the shell's overlay layer; dispatch on the node. */
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

function editor(page: Page) {
  return page.getByRole("textbox", { name: /^Message / });
}

async function typeInComposer(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.type(text, { delay: 12 });
}

async function selectAllInComposer(page: Page) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+A");
}

/**
 * Empties the composer AND drops any pending format.
 *
 * Deleting the text is not enough: Lexical keeps the pending format on the
 * collapsed selection, so the next thing typed inherits the previous case's
 * bold. That is correct while composing one message and wrong between two
 * independent checks, which would otherwise each start where the last left off.
 */
async function clearComposer(page: Page) {
  await selectAllInComposer(page);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(80);
  for (const name of ["Bold", "Italic"]) {
    const button = page.getByRole("toolbar", { name: "Message formatting" }).getByRole("button", { name, exact: true });
    if ((await button.getAttribute("aria-pressed")) === "true") {
      await button.click();
      await page.waitForTimeout(60);
    }
  }
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
const alex = await login(alexContext, accounts.alex.email);
const blair = await login(blairContext, accounts.blair.email);

await openDrawer(alex);
await startDirect(alex, accounts.blair.name);

// ---------------------------------------------------------------------------
// 1. Rich text: what the writer sees is markup, not syntax.
// ---------------------------------------------------------------------------

const composer = editor(alex);

// The placeholder is a sibling overlay, so it has to be positioned, muted and
// gone the moment anything is typed.
const placeholder = alex.getByText(new RegExp("^Message " + accounts.blair.name));
check("composer.placeholder.visibleWhenEmpty", await placeholder.first().isVisible());
const placeholderStyle = await placeholder.first().evaluate((node) => ({
  position: getComputedStyle(node).position,
  pointerEvents: getComputedStyle(node).pointerEvents,
}));
check(
  "composer.placeholder.doesNotBlockTyping",
  placeholderStyle.position === "absolute" && placeholderStyle.pointerEvents === "none",
  placeholderStyle,
);

await typeInComposer(alex, "hello");
check("composer.placeholder.hiddenOnceTyping", (await placeholder.count()) === 0);
await selectAllInComposer(alex);
await alex.getByRole("toolbar", { name: "Message formatting" }).getByRole("button", { name: "Bold", exact: true }).click();
await alex.waitForTimeout(120);
check(
  "composer.bold.rendersBold",
  (await composer.locator("strong, b").count()) > 0 &&
    (await composer.innerText()).trim() === "hello",
  { html: (await composer.innerHTML()).slice(0, 200) },
);
check(
  "composer.bold.noMarkdownSyntaxVisible",
  !(await composer.innerText()).includes("**"),
);
check(
  "composer.bold.toolbarShowsActive",
  (await alex.getByRole("toolbar", { name: "Message formatting" }).getByRole("button", { name: "Bold", exact: true }).getAttribute("aria-pressed")) === "true",
);

await clearComposer(alex);
await typeInComposer(alex, "slanted");
await selectAllInComposer(alex);
await alex.getByRole("toolbar", { name: "Message formatting" }).getByRole("button", { name: "Italic", exact: true }).click();
await alex.waitForTimeout(120);
check(
  "composer.italic.rendersItalic",
  (await composer.locator("em, i").count()) > 0 &&
    !(await composer.innerText()).includes("_"),
  { html: (await composer.innerHTML()).slice(0, 300) },
);

await clearComposer(alex);
await typeInComposer(alex, "one");
await selectAllInComposer(alex);
await alex.getByRole("toolbar", { name: "Message formatting" }).getByRole("button", { name: "Bulleted list", exact: true }).click();
await alex.waitForTimeout(120);
check("composer.bullets.rendersList", (await composer.locator("ul li").count()) === 1);
check("composer.bullets.noDashSyntax", !(await composer.innerText()).trim().startsWith("-"));

await clearComposer(alex);
await typeInComposer(alex, "first");
await selectAllInComposer(alex);
await alex.getByRole("toolbar", { name: "Message formatting" }).getByRole("button", { name: "Numbered list", exact: true }).click();
await alex.waitForTimeout(120);
check("composer.numbered.rendersList", (await composer.locator("ol li").count()) === 1);
check("composer.numbered.noDigitSyntax", !(await composer.innerText()).trim().startsWith("1."));

// Link: an inline field, never window.prompt.
await clearComposer(alex);
await alex.evaluate(() => {
  (window as unknown as { __wfPrompted: boolean }).__wfPrompted = false;
  window.prompt = () => {
    (window as unknown as { __wfPrompted: boolean }).__wfPrompted = true;
    return null;
  };
});
await typeInComposer(alex, "Wolf Forge");
await selectAllInComposer(alex);
await alex.getByRole("toolbar", { name: "Message formatting" }).getByRole("button", { name: "Insert link", exact: true }).click();
const linkField = alex.getByLabel("Link address");
await linkField.waitFor();
await linkField.fill("https://wolf-forge.com");
await linkField.press("Enter");
await alex.waitForTimeout(150);
check("composer.link.rendersAnchor", (await composer.locator("a").count()) === 1);
check(
  "composer.link.noWindowPrompt",
  (await alex.evaluate(() => (window as unknown as { __wfPrompted: boolean }).__wfPrompted)) === false,
);
check("composer.link.noBracketSyntax", !(await composer.innerText()).includes("]("));

// Unsafe protocol is refused, and the draft survives.
await clearComposer(alex);
await typeInComposer(alex, "Danger");
await selectAllInComposer(alex);
await alex.getByRole("toolbar", { name: "Message formatting" }).getByRole("button", { name: "Insert link", exact: true }).click();
const unsafeField = alex.getByLabel("Link address");
await unsafeField.fill("javascript:alert(1)");
await unsafeField.press("Enter");
await alex.waitForTimeout(150);
check(
  "composer.link.unsafeRefused",
  (await alex.getByRole("dialog", { name: "Team Messages" }).getByRole("alert").innerText()).includes("http"),
);
check("composer.link.unsafeLeavesNoAnchor", (await composer.locator("a").count()) === 0);

// Escape cancels.
await alex.getByLabel("Link address").press("Escape");
await alex.waitForTimeout(120);
check("composer.link.escapeCloses", (await alex.getByLabel("Link address").count()) === 0);

// Undo / redo.
await clearComposer(alex);
await typeInComposer(alex, "undoable");
await selectAllInComposer(alex);
await alex.getByRole("toolbar", { name: "Message formatting" }).getByRole("button", { name: "Bold", exact: true }).click();
await alex.waitForTimeout(150);
const boldBefore = await composer.locator("strong, b").count();
await alex.getByRole("toolbar", { name: "Message formatting" }).getByRole("button", { name: "Undo", exact: true }).click();
await alex.waitForTimeout(200);
const boldAfterUndo = await composer.locator("strong, b").count();
await alex.getByRole("toolbar", { name: "Message formatting" }).getByRole("button", { name: "Redo", exact: true }).click();
await alex.waitForTimeout(200);
const boldAfterRedo = await composer.locator("strong, b").count();
check("composer.undo.removesFormatting", boldBefore > 0 && boldAfterUndo === 0, {
  boldBefore,
  boldAfterUndo,
});
check("composer.redo.restoresFormatting", boldAfterRedo > 0, { boldAfterRedo });

// Keyboard shortcuts, each from a plain start.
//
// Checked separately because Lexical renders one element per text node: bold
// alone is <strong>, italic alone is <em>, and bold+italic is a <strong>
// carrying the italic class rather than a nested <em>. Asserting the second
// shortcut on top of the first would be asserting that implementation detail
// instead of the shortcut.
await clearComposer(alex);
await typeInComposer(alex, "shortcut");
await selectAllInComposer(alex);
await alex.keyboard.press("ControlOrMeta+b");
await alex.waitForTimeout(150);
check("composer.ctrlB", (await composer.locator("strong, b").count()) > 0, {
  html: (await composer.innerHTML()).slice(0, 200),
});

// Combined formatting still READS as italic, which is what the writer sees.
await alex.keyboard.press("ControlOrMeta+i");
await alex.waitForTimeout(150);
check(
  "composer.ctrlI.combinesWithBold",
  (await composer
    .locator("strong, b, em, i")
    .first()
    .evaluate((node) => getComputedStyle(node).fontStyle)) === "italic",
);

await clearComposer(alex);
await typeInComposer(alex, "slant");
await selectAllInComposer(alex);
await alex.keyboard.press("ControlOrMeta+i");
await alex.waitForTimeout(150);
check("composer.ctrlI", (await composer.locator("em, i").count()) > 0, {
  html: (await composer.innerHTML()).slice(0, 200),
});

await alex.keyboard.press("ControlOrMeta+k");
await alex.waitForTimeout(150);
check("composer.ctrlK", (await alex.getByLabel("Link address").count()) === 1);
await alex.getByLabel("Link address").press("Escape");

// ---------------------------------------------------------------------------
// 2. Send, and what the recipient sees.
// ---------------------------------------------------------------------------

await clearComposer(alex);
await typeInComposer(alex, "Release plan");
await selectAllInComposer(alex);
await alex.getByRole("toolbar", { name: "Message formatting" }).getByRole("button", { name: "Bold", exact: true }).click();
await alex.waitForTimeout(120);
await editor(alex).click();
await alex.keyboard.press("End");
await alex.keyboard.press("Enter");
await alex.waitForTimeout(400);

check("composer.clearsAfterSend", (await composer.innerText()).trim() === "");
check(
  "composer.keepsFocusAfterSend",
  await alex.evaluate(() => document.activeElement?.getAttribute("contenteditable") === "true"),
);
check(
  "composer.undoDisabledAfterSend",
  await alex.getByRole("toolbar", { name: "Message formatting" }).getByRole("button", { name: "Undo", exact: true }).isDisabled(),
);

const alexTranscript = alex.getByRole("dialog", { name: "Team Messages" });
await alexTranscript.getByText("Release plan").first().waitFor({ timeout: 10_000 });
check(
  "message.sender.rendersBold",
  (await alexTranscript.locator("strong", { hasText: "Release plan" }).count()) > 0,
);

// Nested inline formatting is the hosted regression this pass exists to pin.
// Lexical owns the editor tree and serializer; the sent bubble owns parsing the
// resulting constrained Markdown. These cases exercise both sides through the
// real send path without logging any non-fixture message body.
const linkedFormattingCases = [
  {
    label: "boldLink",
    buttons: ["Bold"],
    stored: "[**Chatgpt**](https://chatgpt.com/)",
    bold: true,
    italic: false,
  },
  {
    label: "italicLink",
    buttons: ["Italic"],
    stored: "[_Chatgpt_](https://chatgpt.com/)",
    bold: false,
    italic: true,
  },
  {
    label: "boldItalicLink",
    buttons: ["Bold", "Italic"],
    stored: "[**_Chatgpt_**](https://chatgpt.com/)",
    bold: true,
    italic: true,
  },
] as const;

for (const fixture of linkedFormattingCases) {
  await clearComposer(alex);
  await typeInComposer(alex, "Chatgpt");
  await selectAllInComposer(alex);
  for (const buttonName of fixture.buttons) {
    await alex
      .getByRole("toolbar", { name: "Message formatting" })
      .getByRole("button", { name: buttonName, exact: true })
      .click();
  }
  await alex
    .getByRole("toolbar", { name: "Message formatting" })
    .getByRole("button", { name: "Insert link", exact: true })
    .click();
  await alex.getByLabel("Link address").fill("https://chatgpt.com");
  await alex.getByLabel("Link address").press("Enter");
  await alex.waitForTimeout(120);

  const composerLink = composer.locator('a[href="https://chatgpt.com/"]');
  const composerAppearance = await composerLink.evaluate((anchor) => {
    const styled = anchor.querySelector("strong, b, em, i") ?? anchor;
    const style = getComputedStyle(styled);
    const numericWeight = Number.parseInt(style.fontWeight, 10);
    return {
      text: anchor.textContent,
      bold: style.fontWeight === "bold" || (!Number.isNaN(numericWeight) && numericWeight >= 600),
      italic: style.fontStyle === "italic",
    };
  });
  check(
    `composer.${fixture.label}.isWysiwyg`,
    composerAppearance.text === "Chatgpt" &&
      composerAppearance.bold === fixture.bold &&
      composerAppearance.italic === fixture.italic &&
      !(await composer.innerText()).includes("**") &&
      !(await composer.innerText()).includes("_"),
    composerAppearance,
  );

  const sentLinks = alexTranscript.locator(
    'div[class*="formattedMessage"] a[href="https://chatgpt.com/"]',
    { hasText: "Chatgpt" },
  );
  const beforeSend = await sentLinks.count();
  await editor(alex).click();
  await alex.keyboard.press("End");
  await alex.keyboard.press("Enter");
  const sentLink = sentLinks.nth(beforeSend);
  await sentLink.waitFor({ timeout: 10_000 });

  check(
    `message.${fixture.label}.semanticFormatting`,
    (await sentLink.locator("strong").count() > 0) === fixture.bold &&
      (await sentLink.locator("em").count() > 0) === fixture.italic,
  );
  const sentBubbleText = await sentLink.evaluate(
    (anchor) => anchor.closest("div")?.textContent ?? anchor.textContent ?? "",
  );
  check(
    `message.${fixture.label}.noMarkdownSyntax`,
    sentBubbleText === "Chatgpt" &&
      !sentBubbleText.includes("**") &&
      !sentBubbleText.includes("_") &&
      !sentBubbleText.includes("]("),
    { sentBubbleText },
  );

  const storedBody = querySql(
    `select body from public.team_messages where author_profile_id = '${ids.alex}' order by created_at desc, id desc limit 1;`,
  );
  check(`storage.${fixture.label}.canonicalMarkdown`, storedBody === fixture.stored);
}

// A message typed with literal markers must arrive as prose.
await clearComposer(alex);
await typeInComposer(alex, "2*3 costs _less and 100% fine");
await alex.keyboard.press("Enter");
await alex.waitForTimeout(500);
await alexTranscript.getByText("2*3 costs _less and 100% fine").first().waitFor({ timeout: 10_000 });
check(
  "message.literalMarkersStayLiteral",
  (await alexTranscript
    .locator("em", { hasText: "less and 100% fine" })
    .count()) === 0,
);

const storedBodies = querySql(
  `select body from public.team_messages where author_profile_id = '${ids.alex}' order by created_at desc limit 1;`,
);
check("storage.escapesLiteralMarker", storedBodies.includes("\\*") && storedBodies.includes("\\_"), {
  storedBodies,
});

const storedPreview = querySql(
  `select private.team_message_plain_text(body) from public.team_messages where author_profile_id = '${ids.alex}' order by created_at desc limit 1;`,
);
check("projection.previewIsProse", storedPreview === "2*3 costs _less and 100% fine", {
  storedPreview,
});

// Legacy plain text and legacy Markdown, written the way V2.1 wrote them.
const conversationId = querySql(
  `select conversation_id from public.team_conversation_members where profile_id = '${ids.alex}' limit 1;`,
);
querySql(
  `set local role authenticated; ` +
    `select set_config('request.jwt.claims', json_build_object('sub','${ids.blair}','role','authenticated')::text, true); ` +
    `select public.app_send_team_message(gen_random_uuid(), '${conversationId}'::uuid, '**Legacy bold** and _legacy italic_ [Legacy link](https://wolf-forge.com)');`,
);
await alex.waitForTimeout(2_000);
await alexTranscript.getByText("Legacy bold").first().waitFor({ timeout: 12_000 });
check(
  "legacy.markdownStillRenders",
  (await alexTranscript.locator("strong", { hasText: "Legacy bold" }).count()) > 0 &&
    (await alexTranscript.locator("em", { hasText: "legacy italic" }).count()) > 0 &&
    (await alexTranscript.locator('a[href="https://wolf-forge.com/"]').count()) > 0,
);

// ---------------------------------------------------------------------------
// 3. Typing, seen by the other actor.
// ---------------------------------------------------------------------------

await openDrawer(blair);
await blair.getByRole("button", { name: new RegExp(accounts.alex.name) }).first().click();
await blair.getByRole("textbox", { name: /^Message / }).waitFor();
await blair.waitForTimeout(1_200);

const typingSamples: number[] = [];
for (let index = 0; index < 5; index += 1) {
  await clearComposer(alex);
  await alex.waitForTimeout(1_200);
  const startedAt = Date.now();
  await editor(alex).click();
  await alex.keyboard.type("x", { delay: 0 });
  await blair.getByText(/is typing/).first().waitFor({ timeout: 10_000 });
  typingSamples.push(Date.now() - startedAt);
  await clearComposer(alex);
  await blair.getByText(/is typing/).first().waitFor({ state: "detached", timeout: 10_000 });
}
typingSamples.sort((a, b) => a - b);
result["typing.samplesMs"] = typingSamples;
result["typing.medianMs"] = typingSamples[Math.floor(typingSamples.length / 2)];
result["typing.p95Ms"] = typingSamples[typingSamples.length - 1];
check("typing.medianUnder1500ms", typingSamples[Math.floor(typingSamples.length / 2)]! <= 1_500, typingSamples);

// ---------------------------------------------------------------------------
// 4. Off-thread peek, with the drawer shut.
// ---------------------------------------------------------------------------

await blair.keyboard.press("Escape");
await blair.waitForTimeout(500);
check(
  "peek.drawerClosed",
  (await blair.getByRole("button", { name: /^Team Messages/ }).getAttribute("aria-expanded")) !== "true",
);

const peekSamples: number[] = [];
for (let index = 0; index < 4; index += 1) {
  await blair.waitForTimeout(800 + Math.random() * 1_200);
  const startedAt = Date.now();
  querySql(
    `set local role authenticated; ` +
      `select set_config('request.jwt.claims', json_build_object('sub','${ids.alex}','role','authenticated')::text, true); ` +
      `select public.app_send_team_message(gen_random_uuid(), '${conversationId}'::uuid, 'peek probe ${index}');`,
  );
  await blair.getByRole("button", { name: /^Open QA V22 Alex/ }).waitFor({ timeout: 15_000 });
  peekSamples.push(Date.now() - startedAt);
  await blair.waitForTimeout(4_400);
}
peekSamples.sort((a, b) => a - b);
result["peek.samplesMs"] = peekSamples;
result["peek.firstMs"] = peekSamples[0];
result["peek.medianMs"] = peekSamples[Math.floor(peekSamples.length / 2)];
result["peek.maxMs"] = peekSamples[peekSamples.length - 1];
check("peek.medianUnder2000ms", peekSamples[Math.floor(peekSamples.length / 2)]! <= 2_000, peekSamples);

// Ordinary chat must not touch the bell.
const bellRows = querySql(
  `select count(*) from public.notifications where recipient_profile_id = '${ids.blair}' and event_key like 'team-message%';`,
);
check("notifications.noBellForOrdinaryMessage", bellRows === "0", { bellRows });

// ---------------------------------------------------------------------------
// 5. Mobile.
// ---------------------------------------------------------------------------

const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});
const mobile = await login(mobileContext, accounts.alex.email);
await openDrawer(mobile);
await mobile.getByRole("button", { name: new RegExp(accounts.blair.name) }).first().click();
await mobile.getByRole("textbox", { name: /^Message / }).waitFor();
await mobile.waitForTimeout(400);

const overflow = await mobile.evaluate(() => ({
  documentScrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
}));
check(
  "mobile.noHorizontalScroll",
  overflow.documentScrollWidth <= overflow.innerWidth + 1,
  overflow,
);

const toolbarBox = await mobile
  .getByRole("toolbar", { name: "Message formatting" })
  .boundingBox();
check(
  "mobile.toolbarInsideViewport",
  Boolean(toolbarBox) && toolbarBox!.x >= -1 && toolbarBox!.x + toolbarBox!.width <= 391,
  toolbarBox,
);

await mobile.getByRole("textbox", { name: /^Message / }).click();
await mobile.keyboard.type("mobile link");
await mobile.keyboard.press("ControlOrMeta+A");
await mobile.getByRole("toolbar", { name: "Message formatting" }).getByRole("button", { name: "Insert link", exact: true }).click();
const mobileLinkBox = await mobile.getByLabel("Link address").boundingBox();
check(
  "mobile.linkFieldUsable",
  Boolean(mobileLinkBox) && mobileLinkBox!.x >= -1 && mobileLinkBox!.width > 80,
  mobileLinkBox,
);
await mobile.getByLabel("Link address").press("Escape");

const composerBox = await mobile.getByRole("textbox", { name: /^Message / }).boundingBox();
check(
  "mobile.composerVisible",
  Boolean(composerBox) && composerBox!.y + composerBox!.height <= 844,
  composerBox,
);

console.log(JSON.stringify(result, null, 2));

await browser.close();
await removeQaUsers();

const failures = Object.entries(result).filter(([, value]) => String(value).startsWith("FAIL"));
if (failures.length > 0) process.exit(1);
