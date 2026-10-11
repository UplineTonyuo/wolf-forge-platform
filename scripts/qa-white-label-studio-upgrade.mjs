import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const project = "Wolf-Forge-Builder-QA-20261012";
const container = `supabase_db_${project}`;
const origin = "http://127.0.0.1:3015";
const qa = resolve(process.env.WF_BUILDER_QA_DIRECTORY);
const output = resolve("docs/qa/white-label-studio-upgrade");
const visualOnly = process.env.WF_STUDIO_VISUAL_ONLY === "true";
const tenantA = "c70b73ea-99d9-4c1f-9b0c-f7087a724859";
const tenantB = "c70b73ea-99d9-4c1f-9b0c-f7087a724860";
const environment = Object.fromEntries((await readFile(".env.local", "utf8")).split(/\r?\n/).map((line) => line.split(/=(.*)/s).slice(0, 2)).filter((entry) => entry.length === 2));
assert.equal(environment.SUPABASE_URL, "http://127.0.0.1:57321");
const identity = JSON.parse(await readFile(`${qa}/database-identity.json`, "utf8"));
assert.equal(identity.project, project);
function sql(query) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: `begin read only; ${query}; commit;`, encoding: "utf8", windowsHide: true }).trim();
}
function verifyTarget() {
  const inspected = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8", windowsHide: true }))[0];
  assert.equal(inspected.Config.Labels["com.supabase.cli.project"], project);
  assert.equal(inspected.HostConfig.PortBindings["5432/tcp"][0].HostPort, "57322");
  assert.equal(sql("select system_identifier::text from pg_control_system()"), "7695498287066267686");
  assert.equal(sql("select token::text from wf_builder_qa.identity"), identity.probe);
  const owned = JSON.parse(sql(`select json_agg(json_build_object('id',id,'slug',slug) order by id) from public.tenants where id in ('${tenantA}','${tenantB}')`));
  assert.deepEqual(owned, [{ id: tenantA, slug: "builder-qa-a-20261012" }, { id: tenantB, slug: "builder-qa-b-20261012" }]);
}
verifyTarget();
const credentials = JSON.parse(await readFile(`${qa}/private/credentials.json`, "utf8"));
const admin = createClient(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
assert.equal((await admin.auth.signInWithPassword(credentials.platformAdmin)).error, null);
assert.equal((await admin.rpc("app_is_platform_admin")).data, true);
async function readDraft(id) {
  const result = await admin.rpc("app_get_white_label_draft", { p_tenant_id: id });
  assert.equal(result.error, null);
  assert.equal(result.data[0].tenant_id, id);
  return result.data[0];
}
function runtimeSnapshot() {
  return JSON.parse(sql("select json_build_object('publications',(select count(*) from private.tenant_module_publications),'invoices',(select count(*) from public.invoices),'walletTransactions',(select count(*) from public.company_wallet_transactions))"));
}
async function moduleSnapshot(id) {
  const scoped = createClient(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${(await admin.auth.getSession()).data.session.access_token}`, "x-wf-tenant": id } } });
  const result = await scoped.rpc("app_current_user_modules");
  assert.equal(result.error, null);
  return result.data;
}
await mkdir(output, { recursive: true });
const beforeA = await readDraft(tenantA);
const beforeB = await readDraft(tenantB);
const baselineRuntime = runtimeSnapshot();
const baselineModules = { a: await moduleSnapshot(tenantA), b: await moduleSnapshot(tenantB) };
const evidence = { project, origin, startedAt: new Date().toISOString(), before: { a: beforeA, b: beforeB }, attempts: [], widths: [], checks: {}, pageErrors: [], consoleErrors: [] };
async function record() { await writeFile(`${output}/${visualOnly ? "contrast-keyboard-results" : "results"}.json`, JSON.stringify(evidence, null, 2)); }
const browser = await chromium.launch({ channel: "chrome", headless: true });
async function authenticatedContext(account) {
  const values = [];
  const auth = createServerClient(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => values, setAll: (cookies) => values.push(...cookies) } });
  assert.equal((await auth.auth.signInWithPassword(account)).error, null);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies(values.map(({ name, value }) => ({ name, value, url: origin, httpOnly: true, sameSite: "Lax" })));
  return context;
}
const context = await authenticatedContext(credentials.platformAdmin);
const page = await context.newPage();
page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
page.on("console", (entry) => { if (entry.type() === "error") evidence.consoleErrors.push(entry.text()); });
const studio = `${origin}/white-label?tenant=${tenantA}`;
async function settle() { await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})))); }
async function capture(name, fullPage = true) { await page.evaluate(() => scrollTo(0, 0)); await settle(); await page.screenshot({ path: `${output}/${name}.png`, fullPage, caret: "initial" }); }
async function openStudio(target = page) {
  await target.goto(studio, { waitUntil: "domcontentloaded", timeout: 60000 });
  await target.getByLabel("Workspace display name").waitFor();
  await target.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent === "Mobile" && Object.keys(button).some((key) => key.startsWith("__reactProps$") && typeof button[key]?.onClick === "function")));
  await target.getByRole("button", { name: "Mobile", exact: true }).click();
  await target.locator('button[aria-pressed="true"]').filter({ hasText: /^Mobile$/ }).waitFor();
  await target.getByRole("button", { name: "Desktop", exact: true }).click();
  await target.locator('button[aria-pressed="true"]').filter({ hasText: /^Desktop$/ }).waitFor();
}
const saveButton = (target = page) => target.getByRole("button", { name: "Save Draft", exact: true });
try {
  await openStudio();
  if (visualOnly) {
    await page.getByLabel("Primary color", { exact: true }).fill("#767676");
    await page.waitForFunction(() => document.querySelector('[data-testid="preview-frame"]').style.getPropertyValue("--preview-primary") === "#767676");
    const button = page.getByRole("button", { name: "Open Projects preview", exact: true });
    await button.click();
    await button.hover();
    await settle();
    const colors = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      return { foreground: style.color, background: style.backgroundColor };
    });
    const luminance = (color) => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const ratio = (Math.max(luminance(colors.foreground), luminance(colors.background)) + .05) / (Math.min(luminance(colors.foreground), luminance(colors.background)) + .05);
    assert.ok(ratio >= 4.5);
    const keyboardButton = page.getByRole("button", { name: "Open Tickets preview", exact: true });
    await keyboardButton.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await keyboardButton.evaluate((element) => getComputedStyle(element).outlineStyle), "solid");
    await page.keyboard.press("Enter");
    assert.equal(await page.getByTestId("preview-greeting").evaluate((element) => element === document.activeElement), true);
    await capture("contrast-keyboard-1440");
    await page.setViewportSize({ width: 768, height: 1000 });
    await capture("editor-final-768");
    await page.getByRole("button", { name: "Review Draft", exact: true }).click();
    await page.getByText(/The preview adapts its text/).waitFor();
    await capture("review-final-768");
    assert.deepEqual(await readDraft(tenantA), beforeA);
    assert.deepEqual(await readDraft(tenantB), beforeB);
    evidence.checks = { activeHoverContrast: { ...colors, ratio }, keyboardNavigationAndVisibleFocus: true, noDraftWrites: true };
  } else {
  assert.equal(await page.getByLabel("Workspace display name").inputValue(), beforeA.display_name);
  assert.equal(await page.getByRole("navigation", { name: "Settings sections" }).count(), 0);
  const url = page.url();
  for (const width of [320, 360, 390, 430, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await capture(`editor-${width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const device of ["Desktop", "Mobile"]) {
      await page.getByRole("button", { name: device, exact: true }).click();
      await page.getByRole("button", { name: "Open Projects preview", exact: true }).click();
      await page.getByRole("button", { name: /Sample item/ }).click();
      assert.equal(await page.getByTestId("preview-greeting").textContent(), "Projects sample");
      assert.equal(page.url(), url);
      await capture(`${device.toLowerCase()}-interaction-${width}`);
      await page.getByRole("button", { name: "Workspace overview", exact: true }).click();
      await page.getByRole("button", { name: "Explore Tickets preview", exact: true }).click();
      assert.equal(await page.getByTestId("preview-greeting").textContent(), "Tickets");
      await page.getByRole("button", { name: "Workspace overview", exact: true }).click();
    }
    await page.getByRole("button", { name: "Desktop", exact: true }).click();
    await page.getByRole("button", { name: /^Tenant:/ }).click();
    await page.getByRole("listbox").waitFor();
    await capture(`dropdown-${width}`, false);
    await page.keyboard.press("Escape");
    await page.getByRole("listbox").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Review Draft", exact: true }).click();
    assert.equal(await page.getByRole("heading", { name: "Review draft", exact: true }).evaluate((element) => element === document.activeElement), true);
    await capture(`review-${width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole("button", { name: "Back to editing", exact: true }).click();
    evidence.widths.push({ width, noOverflow: true, desktopInteraction: true, mobileInteraction: true, reviewFocus: true, dropdownEscape: true });
  }
  const templates = [
    ["Wolf Forge Default", "#000d51", "#a8832e"], ["Executive Navy", "#111c38", "#c8a96b"], ["Modern Sand", "#4b4138", "#d8bc8c"],
    ["Slate Gold", "#28333f", "#c2a15f"], ["Forest Premium", "#173c32", "#d2b777"], ["Minimal Mono", "#202124", "#e0e0e0"],
  ];
  for (const [name, primary, accent] of templates) {
    await page.getByRole("button", { name, exact: true }).click();
    assert.equal(await page.getByLabel("Primary color", { exact: true }).inputValue(), primary);
    assert.equal(await page.getByTestId("preview-frame").evaluate((element) => element.style.getPropertyValue("--preview-accent")), accent);
  }
  await page.getByLabel("Primary color", { exact: true }).fill("#nope");
  assert.equal(await page.getByLabel("Primary color", { exact: true }).getAttribute("aria-invalid"), "true");
  assert.equal(await saveButton().isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Review Draft", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Reset to Wolf Forge Default", exact: true }).click();
  assert.equal(await page.getByLabel("Primary color", { exact: true }).inputValue(), "#000d51");
  await page.getByLabel("Primary color", { exact: true }).fill("AABBCC");
  assert.equal(await page.getByLabel("Primary color", { exact: true }).inputValue(), "#aabbcc");
  await page.getByLabel("Accent color picker", { exact: true }).fill("#aabbcc");
  await page.getByText(/Primary and accent colors are very similar/).waitFor();
  await page.getByRole("button", { name: "Forest Premium", exact: true }).click();
  await page.getByLabel("Workspace display name").fill("Builder QA Studio Verified");
  await page.getByRole("button", { name: "Open Projects preview", exact: true }).click();
  await page.getByRole("checkbox", { name: "Services", exact: true }).uncheck();
  assert.equal(await page.getByTestId("preview-greeting").textContent(), "Welcome to Builder QA Studio Verified");
  assert.equal(await page.getByRole("button", { name: "Open Projects preview", exact: true }).count(), 0);
  await page.getByRole("checkbox", { name: "Services", exact: true }).check();
  evidence.checks.colorTemplates = true;
  evidence.checks.customHexAndPicker = true;
  evidence.checks.dependencyFallback = true;
  verifyTarget();
  evidence.attempts.push({ operation: "UI draft save", tenant: tenantA, expectedRevision: beforeA.revision });
  await record();
  await saveButton().click();
  await page.getByText(new RegExp(`Draft saved · revision ${beforeA.revision + 1}`)).waitFor();
  const saved = await readDraft(tenantA);
  assert.equal(saved.display_name, "Builder QA Studio Verified");
  assert.equal(saved.primary_color, "#173c32");
  assert.equal(saved.accent_color, "#d2b777");
  assert.deepEqual(saved.module_keys, beforeA.module_keys);
  await page.reload({ waitUntil: "load" });
  assert.equal(await page.getByLabel("Workspace display name").inputValue(), saved.display_name);
  assert.equal(await page.getByLabel("Primary color", { exact: true }).inputValue(), saved.primary_color);
  await page.getByRole("button", { name: "Review Draft", exact: true }).click();
  await page.getByText("No unsaved changes to review.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Back to editing", exact: true }).click();
  evidence.checks.saveReloadRefreshReview = true;
  const stale = await context.newPage();
  await openStudio(stale);
  await page.getByLabel("Workspace display name").fill("Builder QA Conflict Winner");
  evidence.attempts.push({ operation: "conflict winner UI save", tenant: tenantA, expectedRevision: saved.revision });
  await record();
  await saveButton().click();
  await page.getByText(new RegExp(`Draft saved · revision ${saved.revision + 1}`)).waitFor();
  await stale.getByLabel("Workspace display name").fill("Builder QA Stale Edit");
  evidence.attempts.push({ operation: "stale UI save must refuse", tenant: tenantA, expectedRevision: saved.revision });
  await record();
  await saveButton(stale).click();
  await stale.getByText(/Someone else saved this Tenant's draft/).waitFor();
  assert.equal(await stale.getByLabel("Workspace display name").inputValue(), "Builder QA Stale Edit");
  assert.equal((await readDraft(tenantA)).display_name, "Builder QA Conflict Winner");
  await stale.getByRole("button", { name: /Load latest/ }).click();
  await stale.getByLabel("Workspace display name").waitFor();
  assert.equal(await stale.getByLabel("Workspace display name").inputValue(), "Builder QA Conflict Winner");
  await stale.close();
  evidence.checks.staleConflict = true;
  const winner = await readDraft(tenantA);
  const auditBeforeReplay = sql(`select count(*) from public.security_audit_events where event_code='authorization.white_label.draft_saved' and resource_id='${tenantA}'`);
  evidence.attempts.push({ operation: "same-admin exact accepted replay", tenant: tenantA, expectedRevision: saved.revision });
  await record();
  const replay = await admin.rpc("app_save_white_label_draft", { p_tenant_id: tenantA, p_expected_revision: saved.revision, p_display_name: winner.display_name, p_primary_color: winner.primary_color, p_accent_color: winner.accent_color, p_module_keys: winner.module_keys });
  assert.equal(replay.error, null);
  assert.equal(replay.data[0].already_applied, true);
  assert.equal(replay.data[0].revision, winner.revision);
  assert.equal(sql(`select count(*) from public.security_audit_events where event_code='authorization.white_label.draft_saved' and resource_id='${tenantA}'`), auditBeforeReplay);
  evidence.checks.exactReplay = true;
  await page.getByLabel("Workspace display name").fill("Builder QA Lost Response");
  let intercepted = false;
  await page.route("**/white-label**", async (route) => {
    if (!intercepted && route.request().method() === "POST" && route.request().postData()?.includes("expectedRevision")) {
      intercepted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  evidence.attempts.push({ operation: "UI save with response loss after server acceptance", tenant: tenantA, expectedRevision: winner.revision });
  await record();
  await saveButton().click();
  await page.getByText(/The draft could not be saved/).waitFor();
  assert.equal(intercepted, true);
  const uncertain = await readDraft(tenantA);
  assert.equal(uncertain.revision, winner.revision + 1);
  await page.getByLabel("Workspace display name").fill("Builder QA Newer Unsaved Edit");
  await page.unroute("**/white-label**");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByText(new RegExp(`Draft saved · revision ${uncertain.revision}`)).waitFor();
  assert.equal((await readDraft(tenantA)).revision, uncertain.revision);
  assert.equal(await page.getByLabel("Workspace display name").inputValue(), "Builder QA Newer Unsaved Edit");
  assert.equal(await page.getByText("Unsaved changes", { exact: true }).count(), 1);
  evidence.checks.lostResponseReplayKeepsNewerEdits = true;
  await page.getByLabel("Workspace display name").fill(uncertain.display_name);
  await page.getByRole("button", { name: /^Tenant:/ }).click();
  await page.getByRole("option").filter({ hasText: /^Builder QA Tenant B/ }).click();
  await page.getByLabel("Workspace display name").waitFor();
  assert.equal(await page.getByLabel("Workspace display name").inputValue(), beforeB.display_name);
  assert.deepEqual(await readDraft(tenantB), beforeB);
  assert.deepEqual(runtimeSnapshot(), baselineRuntime);
  assert.deepEqual({ a: await moduleSnapshot(tenantA), b: await moduleSnapshot(tenantB) }, baselineModules);
  evidence.checks.tenantIsolationAndDraftOnlyRuntime = true;
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.getByRole("button", { name: "Mobile", exact: true }).evaluate((element) => getComputedStyle(element).transitionDuration), "0s");
  const staffContext = await authenticatedContext(credentials.staff);
  const staffPage = await staffContext.newPage();
  await staffPage.goto(studio, { waitUntil: "load" });
  assert.equal(await staffPage.getByRole("heading", { name: "White Label Studio", exact: true }).count(), 0);
  assert.equal(await staffPage.getByLabel("Workspace display name").count(), 0);
  assert.equal(await staffPage.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "White Label", exact: true }).count(), 0);
  await staffContext.close();
  evidence.checks.staffDenied = true;
  evidence.checks.reducedMotion = true;
  }
  evidence.after = { a: await readDraft(tenantA), b: await readDraft(tenantB), runtime: runtimeSnapshot() };
  assert.deepEqual(evidence.pageErrors, []);
  assert.equal(evidence.consoleErrors.some((message) => message.includes("hydrated")), false);
  evidence.result = "PASS";
  await record();
  console.log(JSON.stringify({ result: evidence.result, widths: evidence.widths.length, checks: evidence.checks, tenantARevision: evidence.after.a.revision, tenantBRevision: evidence.after.b.revision }));
} catch (error) {
  evidence.result = "FAIL";
  evidence.failure = error.message;
  await record();
  await capture("failure").catch(() => {});
  throw error;
} finally {
  await browser.close();
}
