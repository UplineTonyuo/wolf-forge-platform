/**
 * Team Communication V2.4 rendered QA.
 *
 * Uses disposable LOCAL Supabase users, isolated browser contexts, the real
 * HttpOnly login flow, and the real Team drawer. No fixture message body is
 * printed. The caller supplies local-only Supabase credentials via env.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
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
  alex: { email: "qa-team-v24-alex@example.test", name: "QA V24 Alex" },
  blair: { email: "qa-team-v24-blair@example.test", name: "QA V24 Blair" },
  casey: { email: "qa-team-v24-casey@example.test", name: "QA V24 Casey" },
} as const;
const ids: Record<keyof typeof accounts, string> = { alex: "", blair: "", casey: "" };
const directId = randomUUID();
const groupId = randomUUID();
const checks: Record<string, string> = {};
const timing: Record<string, number> = {};
const desktopScreenshot = join(tmpdir(), "wolf-forge-team-v24-desktop.png");
const mobileScreenshot = join(tmpdir(), "wolf-forge-team-v24-mobile.png");

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
  const users = listed.data.users.filter((user) => user.email?.startsWith("qa-team-v24-"));
  if (users.length) {
    const userIds = users.map((user) => `'${user.id}'::uuid`).join(",");
    sql(`
      update public.team_messages
      set reply_to_message_id = null,
          reply_quote_text = null,
          forwarded_from_message_id = null,
          forwarded_from_author_name = null
      where author_profile_id in (${userIds})
         or conversation_id in (select conversation_id from public.team_conversation_members where profile_id in (${userIds}));
      delete from public.team_message_hidden_for_profiles where profile_id in (${userIds});
      delete from public.team_message_reactions where reactor_profile_id in (${userIds});
      delete from public.team_tasks where created_by_profile_id in (${userIds}) or assigned_to_profile_id in (${userIds});
      delete from public.team_messages where author_profile_id in (${userIds})
         or conversation_id in (select conversation_id from public.team_conversation_members where profile_id in (${userIds}));
      delete from public.team_message_deliveries where recipient_profile_id in (${userIds});
      delete from public.notifications where recipient_profile_id in (${userIds});
      delete from public.team_conversation_members where profile_id in (${userIds});
      delete from public.team_conversations where title like 'QA V24 %'
         or id not in (select conversation_id from public.team_conversation_members);
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
    const created = await admin.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
    });
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

function seedConversations() {
  const directKey = [ids.alex, ids.blair].sort().join("|");
  const messages = [
    "Can you check the website report before sending it?",
    "forwarded copy survives source deletion",
    "delete for me private target",
    "delete for everyone shared target",
    "[**ChatGPT**](https://chatgpt.com/)",
  ];
  sql(`
    insert into public.team_conversations (id,conversation_key,created_by_profile_id,kind,title,last_message_at)
    values
      ('${directId}','${directKey}','${ids.alex}','direct',null,now()),
      ('${groupId}','group:${groupId}','${ids.alex}','group','QA V24 Forward Room',now());
    insert into public.team_conversation_members (conversation_id,profile_id,last_read_at)
    values
      ('${directId}','${ids.alex}',now()),('${directId}','${ids.blair}',now()),
      ('${groupId}','${ids.alex}',now()),('${groupId}','${ids.blair}',now()),('${groupId}','${ids.casey}',now());
    insert into public.team_messages (id,request_id,conversation_id,author_profile_id,body,created_at)
    select gen_random_uuid(),gen_random_uuid(),'${directId}','${ids.alex}',body,now()-(ordinality*interval '1 second')
    from unnest(array[${messages.map((message) => `'${message.replaceAll("'", "''")}'`).join(",")}]) with ordinality as fixture(body,ordinality);
    insert into public.team_messages (id,request_id,conversation_id,author_profile_id,body,created_at)
    values
      (gen_random_uuid(),gen_random_uuid(),'${groupId}','${ids.alex}','destination ready',now()-interval '1 second'),
      (gen_random_uuid(),gen_random_uuid(),'${groupId}','${ids.alex}','[Wolf Forge](http://127.0.0.1:3000/dashboard)',now());
  `);
}

async function login(context: BrowserContext, email: string) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
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
  try {
    await page.getByRole("dialog", { name: "Team Messages" }).waitFor({ timeout: 15_000 });
  } catch (error) {
    console.error("DRAWER_DIAGNOSTIC", JSON.stringify({
      url: page.url(),
      title: await page.title(),
      expanded: await trigger.getAttribute("aria-expanded").catch(() => null),
      dialogs: await page.getByRole("dialog").allTextContents().catch(() => []),
      alerts: await page.getByRole("alert").allTextContents().catch(() => []),
    }));
    throw error;
  }
  await page.waitForTimeout(300);
}

async function send(page: Page, body: string) {
  const editor = page.getByRole("textbox", { name: /^Message / });
  await editor.click();
  await page.keyboard.type(body, { delay: 4 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(180);
}

function row(page: Page, text: string | RegExp) {
  return page.locator('[class*="bubbleRow"]', { hasText: text }).last();
}

async function more(page: Page, text: string | RegExp) {
  const target = row(page, text);
  await target.hover();
  await target.getByRole("button", { name: "More" }).click();
  return page.getByRole("dialog", { name: "Message actions" });
}

async function openConversation(page: Page, name: string | RegExp) {
  const activeEditor = page.getByRole("textbox", { name: /^Message / });
  if (await activeEditor.isVisible().catch(() => false)) {
    const label = await activeEditor.getAttribute("aria-label") ?? "";
    const activeMatches = typeof name === "string" ? label.includes(name) : name.test(label);
    if (activeMatches) return;
  }
  const back = page.getByRole("button", { name: "Back to conversations" });
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByRole("button", { name }).first().click();
  await page.getByRole("textbox", { name: /^Message / }).waitFor();
  await page.waitForTimeout(350);
}

async function waitVisible(locator: Locator, timeout = 5_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await locator.isVisible().catch(() => false)) return Date.now() - started;
    await locator.page().waitForTimeout(100);
  }
  return -1;
}

await provisionFixtures();
seedConversations();
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
  await row(alex, "Can you check the website report before sending it?").waitFor();

  await openDrawer(blair);
  await blair.getByRole("button", { name: new RegExp(accounts.alex.name) }).first().click();
  await blair.getByRole("textbox", { name: /^Message / }).waitFor();
  await row(blair, "Can you check the website report before sending it?").waitFor();
  await alex.getByRole("textbox", { name: /^Message / }).waitFor();

  // Compact rail and reactions.
  const reactionTargetBlair = row(blair, "Can you check the website report before sending it?");
  const railAtRest = await reactionTargetBlair.getByRole("toolbar", { name: "Message actions" }).evaluate((node) => ({
    opacity: getComputedStyle(node).opacity,
    pointerEvents: getComputedStyle(node).pointerEvents,
  }));
  check("rail.hiddenNormally", railAtRest.opacity === "0" && railAtRest.pointerEvents === "none", railAtRest);
  await reactionTargetBlair.hover();
  const rail = reactionTargetBlair.getByRole("toolbar", { name: "Message actions" });
  check("rail.onlyThreePrimaryControls", (await rail.getByRole("button").all()).length === 3);
  check("rail.labels",
    await rail.getByRole("button", { name: "React" }).isVisible()
      && await rail.getByRole("button", { name: "Reply" }).isVisible()
      && await rail.getByRole("button", { name: "More" }).isVisible(),
  );
  await rail.getByRole("button", { name: "React" }).click();
  const picker = blair.getByRole("menu", { name: "Reactions" });
  check("reaction.pickerAllNine", (await picker.getByRole("menuitemcheckbox").count()) === 9);
  const heartStarted = Date.now();
  await picker.getByRole("menuitemcheckbox", { name: "Heart" }).click();
  check("reaction.pickerClosesImmediately", (await picker.count()) === 0);
  await blair.getByRole("button", { name: /Heart, 1/ }).waitFor();
  timing["reaction.optimisticMs"] = Date.now() - heartStarted;
  const reactionPropagation = await waitVisible(alex.getByRole("button", { name: /Heart, 1/ }));
  timing["reaction.propagationMs"] = reactionPropagation;
  check("reaction.liveToOtherActor", reactionPropagation >= 0);
  await reactionTargetBlair.hover();
  await reactionTargetBlair.getByRole("button", { name: "React" }).click();
  check("reaction.activeIndicated", (await blair.getByRole("menuitemcheckbox", { name: "Heart" }).getAttribute("aria-checked")) === "true");
  await blair.keyboard.press("Escape");
  check("reaction.escapePickerOnly", (await picker.count()) === 0 && await blair.getByRole("dialog", { name: "Team Messages" }).isVisible());
  await reactionTargetBlair.getByRole("button", { name: "React" }).click();
  await blair.getByRole("textbox", { name: /^Message / }).click();
  check("reaction.outsideDismiss", (await picker.count()) === 0);

  // Whole-message reply, selected-visible-text reply, cancel, send, and jump.
  await reactionTargetBlair.hover();
  await reactionTargetBlair.getByRole("button", { name: "Reply" }).click();
  const composerReplyStrip = blair.locator('[class*="composerReplyStrip"]');
  check("reply.wholeStrip", await composerReplyStrip.getByText(`Replying to ${accounts.alex.name}`).isVisible() && await composerReplyStrip.getByText("Can you check the website report before sending it?").isVisible());
  await blair.getByRole("button", { name: "Cancel reply" }).click();
  check("reply.cancel", (await blair.getByText(`Replying to ${accounts.alex.name}`).count()) === 0);
  const body = reactionTargetBlair.locator('[data-team-message-body]');
  await body.evaluate((element, selected) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent?.includes(selected)) node = walker.nextNode();
    if (!node?.textContent) throw new Error("Selection text node missing.");
    const start = node.textContent.indexOf(selected);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + selected.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, "website report");
  await reactionTargetBlair.getByRole("button", { name: "Reply" }).click();
  const selectedStripText = await composerReplyStrip.innerText();
  check("reply.selectedTextStrip", selectedStripText.includes("website report") && !selectedStripText.includes("Can you check the"));
  const replyStarted = Date.now();
  await send(blair, "I'll finish that tonight.");
  timing["reply.optimisticMs"] = Date.now() - replyStarted;
  const replyPropagation = await waitVisible(row(alex, "I'll finish that tonight."));
  timing["reply.propagationMs"] = replyPropagation;
  check("reply.liveToOtherActor", replyPropagation >= 0);
  const replyRow = row(blair, "I'll finish that tonight.");
  check("reply.sentQuote", await replyRow.getByText("website report", { exact: true }).isVisible());
  await replyRow.locator('button[class*="replyQuote"]').click();
  check("reply.jumpToSource", await reactionTargetBlair.isVisible());

  // More surface, exact ownership options, blur, copy, and existing task composer.
  let actionDialog = await more(blair, "Can you check the website report before sending it?");
  check("more.colleagueOptions",
    await actionDialog.getByRole("button", { name: "Forward", exact: true }).isVisible()
      && await actionDialog.getByRole("button", { name: "Copy", exact: true }).isVisible()
      && await actionDialog.getByRole("button", { name: "Create Task", exact: true }).isVisible()
      && await actionDialog.getByRole("button", { name: "Delete for me", exact: true }).isVisible()
      && (await actionDialog.getByRole("button", { name: "Delete for everyone" }).count()) === 0,
  );
  const blur = await actionDialog.evaluate((node) => getComputedStyle(node.parentElement!).backdropFilter);
  check("more.backgroundBlur", blur !== "none" && blur !== "");
  await blair.waitForTimeout(250);
  await blair.screenshot({ path: desktopScreenshot });
  await blair.keyboard.press("Escape");
  await blair.waitForTimeout(250);
  check("more.escapeOnly", (await actionDialog.count()) === 0 && await blair.getByRole("dialog", { name: "Team Messages" }).isVisible());
  actionDialog = await more(blair, "I'll finish that tonight.");
  check("more.ownDeleteEveryone", await actionDialog.getByRole("button", { name: "Delete for everyone" }).isVisible());
  await actionDialog.getByRole("button", { name: "Close message actions" }).click();

  actionDialog = await more(blair, "ChatGPT");
  await actionDialog.getByRole("button", { name: "Copy", exact: true }).click();
  check("copy.visiblePlainText", (await blair.evaluate(() => navigator.clipboard.readText())) === "ChatGPT");
  actionDialog = await more(blair, "Can you check the website report before sending it?");
  await actionDialog.getByRole("button", { name: "Create Task", exact: true }).click();
  const taskDialog = blair.getByRole("dialog", { name: "Create task" });
  check("task.existingComposerWithSource", await taskDialog.isVisible() && (await taskDialog.innerText()).includes("Can you check the website report"));
  await taskDialog.getByRole("button", { name: "Cancel" }).click();

  // Forward to an authorized group found through a member email.
  await openConversation(blair, /QA V24 Forward Room/);
  await openConversation(alex, new RegExp(accounts.blair.name));
  actionDialog = await more(alex, "forwarded copy survives source deletion");
  await actionDialog.getByRole("button", { name: "Forward", exact: true }).click();
  await actionDialog.getByRole("textbox", { name: "Search forward destinations" }).fill(accounts.casey.email);
  const forwardStarted = Date.now();
  await actionDialog.getByRole("button", { name: /QA V24 Forward Room/ }).click();
  const forwardPropagation = await waitVisible(row(blair, "forwarded copy survives source deletion"));
  timing["forward.propagationMs"] = forwardPropagation;
  check("forward.searchByMemberEmailAndLive", forwardPropagation >= 0);
  check("forward.subtleProvenance", await blair.getByText(`Forwarded from ${accounts.alex.name}`, { exact: true }).isVisible());
  timing["forward.totalMs"] = Date.now() - forwardStarted;

  // Delete for me is durable and actor-local, including search.
  await openConversation(blair, new RegExp(accounts.alex.name));
  actionDialog = await more(blair, "delete for me private target");
  await actionDialog.getByRole("button", { name: "Delete for me", exact: true }).click();
  check("deleteMe.confirmation", await actionDialog.getByText("Delete this message for you?").isVisible());
  await actionDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await row(blair, "delete for me private target").waitFor({ state: "hidden" });
  check("deleteMe.hiddenForActor", (await row(blair, "delete for me private target").count()) === 0);
  check("deleteMe.visibleForOther", await row(alex, "delete for me private target").isVisible());
  await blair.reload();
  await openDrawer(blair);
  await blair.getByRole("button", { name: new RegExp(accounts.alex.name) }).first().click();
  await blair.getByRole("textbox", { name: /^Message / }).waitFor();
  check("deleteMe.survivesRefresh", (await row(blair, "delete for me private target").count()) === 0);
  await blair.keyboard.press("Control+f");
  await blair.getByRole("textbox", { name: "Search conversation" }).fill("delete for me private target");
  await blair.waitForTimeout(1_100);
  check("deleteMe.absentFromSearch", await blair.getByText("No matches in this conversation.").isVisible());
  await blair.getByRole("textbox", { name: "Search conversation" }).press("Escape");

  // Delete for everyone tombstones both actors, removes search, and preserves forward copy.
  await openConversation(alex, new RegExp(accounts.blair.name));
  actionDialog = await more(alex, "delete for everyone shared target");
  await actionDialog.getByRole("button", { name: "Delete for everyone", exact: true }).click();
  check("deleteAll.strongConfirmation", await actionDialog.getByText("People in this conversation will no longer be able to view it.").isVisible());
  const deleteStarted = Date.now();
  await actionDialog.getByRole("button", { name: "Delete", exact: true }).click();
  const deletedOther = await waitVisible(row(blair, "Message deleted"), 10_000);
  timing["deleteAll.propagationMs"] = deletedOther;
  const alexHasTombstone = await row(alex, "Message deleted").isVisible().catch(() => false);
  const blairHasTombstone = await row(blair, "Message deleted").isVisible().catch(() => false);
  check("deleteAll.tombstoneBoth", deletedOther >= 0 && alexHasTombstone && blairHasTombstone, { deletedOther, alexHasTombstone, blairHasTombstone });
  const alexHasOriginal = (await row(alex, "delete for everyone shared target").count()) > 0;
  const blairHasOriginal = (await row(blair, "delete for everyone shared target").count()) > 0;
  check("deleteAll.originalBodyGone", !alexHasOriginal && !blairHasOriginal, { alexHasOriginal, blairHasOriginal });
  timing["deleteAll.totalMs"] = Date.now() - deleteStarted;
  await alex.keyboard.press("Control+f");
  await alex.getByRole("textbox", { name: "Search conversation" }).fill("delete for everyone shared target");
  await alex.waitForTimeout(1_100);
  check("deleteAll.absentFromSearch", await alex.getByText("No matches in this conversation.").isVisible());
  await alex.getByRole("textbox", { name: "Search conversation" }).press("Escape");

  actionDialog = await more(alex, "forwarded copy survives source deletion");
  await actionDialog.getByRole("button", { name: "Delete for everyone", exact: true }).click();
  await actionDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await openConversation(blair, /QA V24 Forward Room/);
  check("forward.copySurvivesOriginalDelete", await row(blair, "forwarded copy survives source deletion").isVisible());

  // Historical reply jump through the existing bounded message-window route.
  const oldId = randomUUID();
  const historicalReplyId = randomUUID();
  sql(`
    insert into public.team_messages (id,request_id,conversation_id,author_profile_id,body,created_at)
    values ('${oldId}',gen_random_uuid(),'${directId}','${ids.alex}','historical bounded source',now()-interval '9 months');
    insert into public.team_messages (id,request_id,conversation_id,author_profile_id,body,created_at)
    select gen_random_uuid(),gen_random_uuid(),'${directId}',case when i%2=0 then '${ids.alex}'::uuid else '${ids.blair}'::uuid end,'history filler '||i,now()-interval '8 months'+i*interval '5 minutes' from generate_series(1,330) i;
    insert into public.team_messages (id,request_id,conversation_id,author_profile_id,body,reply_to_message_id,reply_quote_text)
    values ('${historicalReplyId}',gen_random_uuid(),'${directId}','${ids.blair}','historical source response','${oldId}','historical bounded source');
  `);
  await alex.reload();
  await openDrawer(alex);
  await alex.getByRole("button", { name: new RegExp(accounts.blair.name) }).first().click();
  const historicalReply = row(alex, "historical source response");
  await historicalReply.locator('button[class*="replyQuote"]').click();
  await row(alex, "historical bounded source").waitFor();
  check("reply.historicalBoundedJump", await row(alex, "historical bounded source").isVisible());
  // The existing jump architecture intentionally smooth-scrolls to the
  // bounded window. Let that visual movement finish before targeting a hover
  // control on the historical row itself.
  await alex.waitForTimeout(2_500);

  // Delete the historical source through the real owner UI and prove its reply
  // never leaks the quote after the source becomes a tombstone.
  const historicalSourceRow = alex.locator('[class*="bubbleRow"]', { hasText: "historical bounded source" }).first();
  await historicalSourceRow.hover();
  // This row sits inside a 330-message historical window that is continuously
  // remeasured by the scroll anchor. Dispatching the semantic button click
  // avoids Playwright's pointer-stability retry while still exercising the
  // product handler and owner authorization path.
  await historicalSourceRow.getByRole("button", { name: "More" }).evaluate((button: HTMLButtonElement) => button.click());
  actionDialog = alex.getByRole("dialog", { name: "Message actions" });
  await actionDialog.getByRole("button", { name: "Delete for everyone", exact: true }).click();
  await actionDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await historicalSourceRow.waitFor({ state: "hidden" });
  await alex.reload();
  await openDrawer(alex);
  await alex.getByRole("button", { name: new RegExp(accounts.blair.name) }).first().click();
  await alex.getByRole("textbox", { name: /^Message / }).waitFor();
  const deletedReply = row(alex, "historical source response");
  await deletedReply.waitFor();
  check("reply.deletedSourceState", await deletedReply.getByText("Message deleted", { exact: true }).isVisible() && (await deletedReply.getByText("historical bounded source", { exact: true }).count()) === 0);

  // Mobile: tap rail, reaction picker, blurred bottom sheet, selection, links, overflow.
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  mobileContext.setDefaultTimeout(60_000);
  const mobile = await login(mobileContext, accounts.casey.email);
  await openDrawer(mobile);
  await mobile.getByRole("button", { name: /QA V24 Forward Room/ }).first().click();
  const mobileTarget = row(mobile, "destination ready");
  await mobileTarget.tap();
  check("mobile.tapRail", await mobileTarget.getByRole("button", { name: "React" }).isVisible() && await mobileTarget.getByRole("button", { name: "Reply" }).isVisible() && await mobileTarget.getByRole("button", { name: "More" }).isVisible());
  await mobileTarget.getByRole("button", { name: "React" }).tap();
  check("mobile.picker", await mobile.getByRole("menu", { name: "Reactions" }).isVisible());
  await mobile.getByRole("menuitemcheckbox", { name: "Celebrate" }).tap();
  check("mobile.pickerClosesAfterReact", (await mobile.getByRole("menu", { name: "Reactions" }).count()) === 0);
  await mobileTarget.getByRole("button", { name: "More" }).tap();
  const mobileActions = mobile.getByRole("dialog", { name: "Message actions" });
  const mobileGeometry = await mobileActions.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { bottom: Math.round(rect.bottom), viewport: window.innerHeight, blur: getComputedStyle(node.parentElement!).backdropFilter, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
  });
  check("mobile.blurredBottomSheet", mobileGeometry.bottom >= mobileGeometry.viewport - 2 && mobileGeometry.blur !== "none");
  check("mobile.noHorizontalOverflow", mobileGeometry.scrollWidth <= mobileGeometry.innerWidth + 1, mobileGeometry);
  await mobile.screenshot({ path: mobileScreenshot });
  await mobile.keyboard.press("Escape");
  await mobile.waitForTimeout(250);
  check("mobile.escapeSheetOnly", (await mobileActions.count()) === 0 && await mobile.getByRole("dialog", { name: "Team Messages" }).isVisible());

  const linkRow = row(mobile, "Wolf Forge");
  const popupPromise = mobileContext.waitForEvent("page");
  await linkRow.getByRole("link", { name: "Wolf Forge" }).tap();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  const linkRailState = await linkRow.getByRole("toolbar", { name: "Message actions" }).evaluate((node) => ({
    opacity: getComputedStyle(node).opacity,
    pointerEvents: getComputedStyle(node).pointerEvents,
  }));
  check("mobile.linkOpensWithoutActions", popup.url().includes("/dashboard") && linkRailState.opacity === "0" && linkRailState.pointerEvents === "none", { popupUrl: popup.url(), linkRailState });
  await popup.close();

  const mobileBody = mobileTarget.locator('[data-team-message-body]');
  await mobileBody.evaluate((element, selected) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent?.includes(selected)) node = walker.nextNode();
    if (!node?.textContent) throw new Error("Mobile selection text node missing.");
    const start = node.textContent.indexOf(selected);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + selected.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, "destination");
  await mobileTarget.getByRole("button", { name: "Reply" }).tap();
  const mobileReplyStrip = mobile.locator('[class*="composerReplyStrip"]');
  const mobileReplyText = await mobileReplyStrip.innerText();
  check("mobile.selectedTextReply", mobileReplyText.includes("destination") && !mobileReplyText.includes("destination ready"));
  await mobile.getByRole("button", { name: "Cancel reply" }).tap();
  await mobileContext.close();

  console.log("SCREENSHOTS", JSON.stringify({ desktopScreenshot, mobileScreenshot }));
  console.log("TIMING", JSON.stringify(timing));
  console.log("CHECKS", JSON.stringify(checks));
  const failures = Object.entries(checks).filter(([, value]) => value.startsWith("FAIL"));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
  await cleanFixtures();
}
