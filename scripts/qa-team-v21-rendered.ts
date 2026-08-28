import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { stripTeamFormatting } from "../src/domain/team/formatting";
import type { Database } from "../src/lib/supabase/database.types";

const baseUrl = process.env.QA_BASE_URL ?? "http://localhost:3100";
const apiUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const password = process.env.QA_TEAM_PASSWORD;

if (!apiUrl || !publishableKey || !secretKey || !password) {
  throw new Error("Local QA environment is incomplete.");
}

const admin = createClient<Database>(apiUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const accounts = {
  admin: { email: "qa-team-v21-admin@example.test", name: "QA V21 Admin", role: "admin" },
  staff: { email: "qa-team-v21-staff@example.test", name: "QA V21 Staff", role: "staff" },
  third: { email: "qa-team-v21-third@example.test", name: "QA V21 Third", role: "staff" },
} as const;

const result: Record<string, unknown> = {};
const userIds: string[] = [];

/**
 * Local-only superuser session. Team tables grant nothing to service_role by
 * design — only SECURITY DEFINER RPCs reach them — so PostgREST cannot clear
 * fixtures and the teardown needs a direct psql session.
 */
const dbContainer = process.env.QA_DB_CONTAINER ?? "supabase_db_Wolf-Forge-Platform";

function querySql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", dbContainer, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAc", sql],
    { encoding: "utf8", windowsHide: true },
  ).trim();
}

function runSql(sql: string) {
  querySql(sql);
}

async function removeQaUsers() {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  const matches = listed.data.users.filter((user) =>
    user.email?.startsWith("qa-team-v21-") || user.email?.startsWith("qa-v21-created-"),
  );
  if (matches.length === 0) return;

  /*
   * Team rows reference profiles with ON DELETE RESTRICT on purpose: a
   * colleague who authored a message is not silently erasable, and that rule
   * is product behaviour worth keeping. So the synthetic rows are removed in
   * dependency order first, scoped strictly to the QA profiles and the
   * conversations those profiles belong to. No product data is in range.
   */
  runSql(`
    create temp table qa_ids(id uuid);
    insert into qa_ids(id) values ${matches.map((user) => `('${user.id}'::uuid)`).join(", ")};
    create temp table qa_convos as
      select distinct conversation_id
      from public.team_conversation_members
      where profile_id in (select id from qa_ids);
    delete from public.team_message_deliveries
      where conversation_id in (select conversation_id from qa_convos)
         or recipient_profile_id in (select id from qa_ids);
    delete from public.team_tasks
      where conversation_id in (select conversation_id from qa_convos)
         or assigned_to_profile_id in (select id from qa_ids)
         or created_by_profile_id in (select id from qa_ids)
         or completed_by_profile_id in (select id from qa_ids);
    delete from public.team_messages
      where conversation_id in (select conversation_id from qa_convos)
         or author_profile_id in (select id from qa_ids);
    delete from public.team_conversation_members
      where conversation_id in (select conversation_id from qa_convos)
         or profile_id in (select id from qa_ids);
    delete from public.team_conversations
      where id in (select conversation_id from qa_convos)
         or created_by_profile_id in (select id from qa_ids);
    delete from public.team_typing_connections where profile_id in (select id from qa_ids);
    delete from public.team_presence_connections where profile_id in (select id from qa_ids);
    delete from public.notifications
      where recipient_profile_id in (select id from qa_ids)
         or actor_profile_id in (select id from qa_ids);
    -- activity_events is append-only by trigger, and its actor FK is
    -- ON DELETE SET NULL, so those rows need no cleanup and must not be
    -- deleted. The audit trail stays intact.
    drop table qa_convos;
    drop table qa_ids;
  `);
  for (const user of matches) {
    const deleted = await admin.auth.admin.deleteUser(user.id);
    if (deleted.error) throw deleted.error;
  }
}

async function provisionFixtures() {
  await removeQaUsers();
  const roles = await admin.from("roles").select("id,name").in("name", ["admin", "staff"]);
  if (roles.error) throw roles.error;
  const roleIds = new Map(roles.data.map((role) => [role.name, role.id]));

  for (const account of Object.values(accounts)) {
    const created = await admin.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw created.error ?? new Error("Fixture user missing.");
    userIds.push(created.data.user.id);
    const updated = await admin
      .from("profiles")
      .update({
        role_id: roleIds.get(account.role)!,
        display_name: account.name,
        archived_at: null,
        company_id: null,
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
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  return page;
}

/**
 * The trigger sits under the shell's own overlay layer, so a synthetic
 * Playwright click can land on the wrong element. Dispatching the click on the
 * node itself is what the cold-open measurement already relies on; every other
 * open uses it too, so they cannot diverge.
 */
async function clickTeamTrigger(page: Page) {
  await page
    .getByRole("button", { name: /^Team Messages/ })
    .evaluate((element: HTMLButtonElement) => element.click());
}

/** Idempotent: the drawer may already be open from an earlier step. */
async function openTeamDrawer(page: Page) {
  const trigger = page.getByRole("button", { name: /^Team Messages/ });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await clickTeamTrigger(page);
  }
  await page.getByRole("dialog", { name: "Team Messages" }).waitFor();
  // The drawer animates in; clicking mid-transition detaches the target.
  await page.waitForTimeout(350);
}

async function openTeam(page: Page) {
  const started = performance.now();
  const trigger = page.getByRole("button", { name: /^Team Messages/ });
  await clickTeamTrigger(page);
  await page.waitForTimeout(500);
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    throw new Error(`Team trigger did not open at ${page.url()}; body=${(await page.locator("body").innerText()).slice(0, 500)}`);
  }
  await page.getByRole("dialog", { name: "Team Messages" }).waitFor();
  await page.getByText(/No conversations yet|No messages yet/, { exact: false }).first().waitFor();
  return Math.round(performance.now() - started);
}

async function startDirect(page: Page, query: string) {
  await page.getByRole("button", { name: "Start a new conversation or group" }).click();
  await page.getByRole("button", { name: /New message/ }).click();
  const search = page.getByRole("combobox", { name: "Search teammates" });
  await search.fill(query);
  await search.press("Enter");
  await page.getByRole("textbox", { name: /^Message / }).waitFor();
}

async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: /^Message / });
  await composer.fill(text);
  await composer.press("Enter");
  /*
   * A formatted message renders as marked-up nodes, not as its source. The
   * bubble is confirmed against the same plain-text projection the previews,
   * peeks and digests use, which also checks that projection agrees with what
   * the renderer produced.
   */
  await page
    .getByText(stripTeamFormatting(text), { exact: false })
    .last()
    .waitFor();
}

async function percentile(values: number[], fraction: number) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)]!;
}

await provisionFixtures();

const browser = await chromium.launch({ headless: true });
const adminContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const staffContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
});

try {
  const adminPage = await login(adminContext, accounts.admin.email);
  const staffPage = await login(staffContext, accounts.staff.email);
  const mobilePage = await login(mobileContext, accounts.third.email);

  result.coldOpenMs = await openTeam(adminPage);
  await startDirect(adminPage, "staff@example.test");
  result.emailSearchMatched = await adminPage.getByRole("textbox", { name: /^Message QA V21 Staff/ }).isVisible();

  await openTeamDrawer(staffPage);
  await staffPage.getByRole("button", { name: /QA V21 Admin/ }).click();
  const staffComposer = staffPage.getByRole("textbox", { name: /^Message QA V21 Admin/ });
  await staffComposer.waitFor();

  const typingMs: number[] = [];
  const clearMs: number[] = [];
  // Typing renders in both the conversation header and the transcript; either
  // one appearing is the observable event being measured.
  const typingIndicator = adminPage.getByText(/is typing/).first();
  for (let index = 0; index < 10; index += 1) {
    const appearedAt = performance.now();
    await staffComposer.fill(`typing ${index}`);
    await typingIndicator.waitFor({ state: "visible", timeout: 2_500 });
    typingMs.push(Math.round(performance.now() - appearedAt));
    const clearedAt = performance.now();
    await staffComposer.fill("");
    await typingIndicator.waitFor({ state: "hidden", timeout: 2_500 });
    clearMs.push(Math.round(performance.now() - clearedAt));
  }
  result.typingMs = typingMs;
  result.typingMedianMs = await percentile(typingMs, 0.5);
  result.typingP95Ms = await percentile(typingMs, 0.95);
  result.typingClearP95Ms = await percentile(clearMs, 0.95);

  const formatted = "**Bold V21** and *italic V21* with [safe link](https://example.com)";
  await send(adminPage, formatted);
  /*
   * `send` only confirms the SENDER's bubble. The recipient renders on its own
   * sync tick, so the formatted nodes have to be awaited on that page before
   * they are asserted — `isVisible()` does not wait, and asserting straight
   * after the send measured the race rather than the renderer.
   */
  const staffBold = staffPage.locator("strong", { hasText: "Bold V21" }).last();
  await staffBold.waitFor({ timeout: 10_000 });
  result.formattedBold = await staffBold.isVisible();
  const staffItalic = staffPage.locator("em", { hasText: "italic V21" }).last();
  await staffItalic.waitFor({ timeout: 10_000 });
  result.formattedItalic = await staffItalic.isVisible();
  /*
   * Backward compatibility: a legacy plain message with unpaired punctuation
   * must survive verbatim and gain no markup.
   */
  const legacy = "Legacy plain V21 2*3 costs _less and 100% fine";
  await send(adminPage, legacy);
  const legacyBubble = staffPage.getByText(legacy, { exact: false }).last();
  await legacyBubble.waitFor({ timeout: 10_000 });
  result.legacyPlainText = {
    rendered: (await legacyBubble.textContent())?.trim() ?? null,
    gainedMarkup:
      (await legacyBubble.locator("strong, em, a").count()) > 0,
  };
  const safeLink = staffPage.getByRole("link", { name: "safe link" }).last();
  result.safeLink = {
    href: await safeLink.getAttribute("href"),
    rel: await safeLink.getAttribute("rel"),
    target: await safeLink.getAttribute("target"),
  };

  await adminPage.getByRole("button", { name: "Close Team Messages" }).click();
  await adminPage.getByRole("dialog", { name: "Team Messages" }).waitFor({ state: "hidden" });
  const warmOpenMs: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now();
    await clickTeamTrigger(adminPage);
    await adminPage.getByRole("textbox", { name: /^Message QA V21 Staff/ }).waitFor();
    warmOpenMs.push(Math.round(performance.now() - started));
    await adminPage.getByRole("button", { name: "Close Team Messages" }).click();
    await adminPage.getByRole("dialog", { name: "Team Messages" }).waitFor({ state: "hidden" });
  }
  result.warmOpenMs = warmOpenMs;
  result.warmOpenMedianMs = await percentile(warmOpenMs, 0.5);

  await staffPage.getByRole("button", { name: "Close Team Messages" }).click();
  await staffPage.getByRole("dialog", { name: "Team Messages" }).waitFor({ state: "hidden" });
  await clickTeamTrigger(adminPage);
  await adminPage.getByRole("textbox", { name: /^Message QA V21 Staff/ }).waitFor();
  await send(adminPage, "Peek first V21");
  await send(adminPage, "Peek second V21");
  const peek = staffPage.getByRole("button", { name: /Open QA V21 Admin:/ });
  await peek.waitFor({ timeout: 5_000 });
  result.peek = {
    countCollapsed: await peek.getByText("2 unread").isVisible(),
    preview: await peek.textContent(),
    rightEdge: Math.round((await peek.boundingBox())!.x + (await peek.boundingBox())!.width),
  };
  await peek.click();
  await staffPage.getByRole("textbox", { name: /^Message QA V21 Admin/ }).waitFor();
  result.peekOpenedConversation = true;

  /*
   * `notifications` grants nothing to service_role either, so the bell is
   * counted through the same local superuser session as the teardown rather
   * than through PostgREST.
   */
  result.ordinaryMessageBellRows = Number(
    querySql(
      "select count(*) from public.notifications where category = 'team' and entity_type = 'team_message';",
    ),
  );
  result.teamTaskBellRowsForFixtures = Number(
    querySql(
      "select count(*) from public.notifications n join auth.users u on u.id = n.recipient_profile_id" +
        " where n.category = 'team' and n.entity_type = 'team_task' and u.email like 'qa-team-v21-%';",
    ),
  );
  /*
   * Both actors stay online for this whole pass, so zero is the ASSERTION, not
   * a gap: an online recipient must never enter the offline ledger and must
   * never receive a digest. The offline half of that rule is proved in
   * 047_team_communication_v21_hardening.test.sql, where presence can be aged
   * past its window without waiting for real time to pass.
   */
  result.staleDigestRowsWhileOnline = Number(
    querySql(
      "select count(*) from public.notifications where event_key like 'team-message-digest:%';",
    ),
  );
  result.offlineDeliveryRowsWhileOnline = Number(
    querySql("select count(*) from public.team_message_deliveries;"),
  );

  await openTeamDrawer(mobilePage);
  await mobilePage.getByRole("button", { name: "Start a new conversation or group" }).click();
  await mobilePage.getByRole("button", { name: /New message/ }).click();
  const mobileSearch = mobilePage.getByRole("combobox", { name: "Search teammates" });
  await mobileSearch.fill("admin@example.test");
  await mobileSearch.press("Enter");
  await mobilePage.getByRole("toolbar", { name: "Message formatting" }).waitFor();
  const toolbarBox = await mobilePage.getByRole("toolbar", { name: "Message formatting" }).boundingBox();
  result.mobile = {
    toolbarInViewport: Boolean(toolbarBox && toolbarBox.x >= 0 && toolbarBox.x + toolbarBox.width <= 390),
    horizontalOverflow: await mobilePage.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  };

  await adminPage.goto(`${baseUrl}/accounts/member/new`, { waitUntil: "domcontentloaded" });
  const roleRadios = adminPage.getByRole("radio");
  result.roleSelector = {
    count: await roleRadios.count(),
    nativeSelects: await adminPage.locator("select").count(),
    defaultStaff: await adminPage.getByRole("radio", { name: /Staff/ }).getAttribute("aria-checked"),
  };

  /*
   * New-member discovery. The staff client keeps Team Messages open and never
   * reloads; the roster has to reconcile through the ordinary sync cadence.
   * Measured from the moment provisioning is submitted to the moment the new
   * teammate is selectable in the picker on the OTHER client.
   */
  await adminPage.getByRole("radio", { name: /Manager/ }).click();
  const newMemberEmail = `qa-v21-created-${Date.now()}@example.test`;
  await adminPage.locator('input[name="email"]').fill(newMemberEmail);
  await adminPage.locator('input[name="first_name"]').fill("Nova");
  await adminPage.locator('input[name="last_name"]').fill("Recruit");
  await adminPage.locator('input[name="temporary_password"]').fill(password!);
  await adminPage.locator('input[name="confirm_password"]').fill(password!);

  await openTeamDrawer(staffPage);
  await staffPage.getByRole("button", { name: "Start a new conversation or group" }).click();
  await staffPage.getByRole("button", { name: /New message/ }).click();
  const staffSearch = staffPage.getByRole("combobox", { name: "Search teammates" });
  await staffSearch.fill("Nova Recruit");
  result.newMemberVisibleBeforeProvisioning = await staffPage
    .getByRole("option", { name: /Nova Recruit/ })
    .count();

  const provisionedAt = performance.now();
  await adminPage.getByRole("button", { name: /Add member/ }).click();
  try {
    await staffPage
      .getByRole("option", { name: /Nova Recruit/ })
      .waitFor({ timeout: 15_000 });
    result.newMemberVisibleMs = Math.round(performance.now() - provisionedAt);
    result.newMemberWithoutReload = true;
  } catch (error) {
    // Distinguish "provisioning failed" from "roster did not reconcile".
    result.newMemberProvisioningDiagnostics = {
      adminUrl: adminPage.url(),
      adminAlerts: await adminPage.getByRole("alert").allTextContents(),
      rowExists: querySql(
        `select count(*) from auth.users where email = '${newMemberEmail}';`,
      ),
      profileReady: querySql(
        `select coalesce(string_agg(p.display_name || ' archived=' || coalesce(p.archived_at::text,'no'), ' | '), '(no profile)')
         from public.profiles p join auth.users u on u.id = p.id where u.email = '${newMemberEmail}';`,
      ),
      staffOptionCount: await staffPage.getByRole("option").count(),
    };
    throw error;
  }

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("QA FAILED. Partial result:");
  console.error(JSON.stringify(result, null, 2));
  console.error(
    "QA ERROR:",
    error instanceof Error ? (error.stack ?? error.message) : JSON.stringify(error),
  );
  throw error;
} finally {
  await browser.close();
  await removeQaUsers();
}
