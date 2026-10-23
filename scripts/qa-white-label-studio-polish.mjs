import { chromium } from "playwright";
import { createServerClient } from "@supabase/ssr";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

// Browser plugin not available; use installed Playwright against the isolated builder stack.
const origin = "http://127.0.0.1:3015";
const qa = resolve(process.env.WF_BUILDER_QA_DIRECTORY);
const output = resolve("docs/qa/white-label-studio-polish");
const flowsOnly = process.env.WF_POLISH_FLOWS_ONLY === "true";
const confirmOnly = process.env.WF_POLISH_CONFIRM_ONLY === "true";
const tenantA = "c70b73ea-99d9-4c1f-9b0c-f7087a724859";
const tenantB = "c70b73ea-99d9-4c1f-9b0c-f7087a724860";
const environment = Object.fromEntries((await readFile(".env.local", "utf8")).split(/\r?\n/).map((line) => line.split(/=(.*)/s).slice(0, 2)).filter((entry) => entry.length === 2));
assert.equal(environment.SUPABASE_URL, "http://127.0.0.1:57321");
const container = "supabase_db_Wolf-Forge-Builder-QA-20261012";
function sql(query) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: `begin read only; ${query}; commit;`, encoding: "utf8", windowsHide: true }).trim();
}
const identity = JSON.parse(await readFile(`${qa}/database-identity.json`, "utf8"));
const inspected = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8", windowsHide: true }))[0];
assert.equal(inspected.Config.Labels["com.supabase.cli.project"], "Wolf-Forge-Builder-QA-20261012");
assert.equal(inspected.HostConfig.PortBindings["5432/tcp"][0].HostPort, "57322");
assert.equal(sql("select system_identifier::text from pg_control_system()"), "7695498287066267686");
assert.equal(sql("select token::text from wf_builder_qa.identity"), identity.probe);
assert.deepEqual(JSON.parse(sql(`select json_agg(slug order by id) from public.tenants where id in ('${tenantA}','${tenantB}')`)), ["builder-qa-a-20261012", "builder-qa-b-20261012"]);
const credentials = JSON.parse(await readFile(`${qa}/private/credentials.json`, "utf8"));
const values = [];
const admin = createServerClient(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => values, setAll: (cookies) => values.push(...cookies) } });
assert.equal((await admin.auth.signInWithPassword(credentials.platformAdmin)).error, null);
assert.equal((await admin.rpc("app_is_platform_admin")).data, true);
async function draft(id) {
  const result = await admin.rpc("app_get_white_label_draft", { p_tenant_id: id });
  assert.equal(result.error, null);
  assert.equal(result.data[0].tenant_id, id);
  return result.data[0];
}
function runtime() {
  return sql("select json_build_object('publications',(select count(*) from private.tenant_module_publications),'invoices',(select count(*) from public.invoices),'walletTransactions',(select count(*) from public.company_wallet_transactions))");
}
const baseline = { a: await draft(tenantA), b: await draft(tenantB), runtime: runtime() };
const evidence = { origin, startedAt: new Date().toISOString(), baseline, widths: [], checks: [], attempts: [], errors: [], consoleErrors: [] };
if (flowsOnly || confirmOnly) {
  const previous = JSON.parse(await readFile(`${output}/results.json`, "utf8"));
  evidence.widths = previous.widths;
  if (confirmOnly) evidence.workflowEvidence = typeof previous.workflowEvidence === "string"
    ? JSON.parse(await readFile(`${output}/${previous.workflowEvidence}`, "utf8"))
    : previous.workflowEvidence ?? previous;
}
await mkdir(output, { recursive: true });
async function record() { await writeFile(`${output}/results.json`, JSON.stringify(evidence, null, 2)); }
await record();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies(values.map(({ name, value }) => ({ name, value, url: origin, httpOnly: true, sameSite: "Lax" })));
const page = await context.newPage();
page.on("pageerror", (error) => evidence.errors.push(error.message));
page.on("console", (entry) => { if (entry.type() === "error") evidence.consoleErrors.push(entry.text()); });
const button = (name) => page.getByRole("button", { name, exact: true });
const nameField = () => page.getByLabel("Workspace display name");
async function settle() {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))));
}
async function capture(name, locator) {
  await settle();
  if (locator) await locator.screenshot({ path: `${output}/${name}.png` });
  else { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: `${output}/${name}.png`, fullPage: true }); }
}
async function ready() {
  await nameField().waitFor({ timeout: 90000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((element) => element.textContent === "Mobile" && Object.keys(element).some((key) => key.startsWith("__reactProps$") && typeof element[key]?.onClick === "function")));
}
async function selectTenant(id) {
  await page.getByRole("button", { name: /^Tenant:/ }).click();
  await page.getByRole("option").filter({ hasText: id === tenantA ? "Builder QA Tenant A" : "Builder QA Tenant B" }).click();
  await ready();
}
async function save(label) {
  const current = await draft(new URL(page.url()).searchParams.get("tenant"));
  evidence.attempts.push({ label, tenant: current.tenant_id, expectedRevision: current.revision, name: await nameField().inputValue() });
  await record();
  await button("Save Draft").click();
  await page.getByText(`Draft saved · revision ${current.revision + 1}. Nothing was published.`, { exact: true }).waitFor({ timeout: 30000 });
}
async function restore(id, original) {
  const current = await draft(id);
  if (current.display_name === original.display_name && current.primary_color === original.primary_color && current.accent_color === original.accent_color && JSON.stringify(current.module_keys) === JSON.stringify(original.module_keys)) return;
  await page.goto(`${origin}/white-label?tenant=${id}`, { waitUntil: "domcontentloaded" });
  await ready();
  await nameField().fill(original.display_name);
  await page.getByLabel("Primary color", { exact: true }).fill(original.primary_color);
  await page.getByLabel("Accent color", { exact: true }).fill(original.accent_color);
  const keys = ["services", "projects", "tickets", "subscriptions", "coupons", "reporting", "investment_intent", "invoices", "forms"];
  const labels = ["Services", "Projects", "Tickets", "Subscriptions", "Coupons", "Reporting", "Investment Intent", "Invoices", "Forms"];
  for (let index = 0; index < keys.length; index++) await page.getByRole("checkbox", { name: labels[index], exact: true }).setChecked(original.module_keys.includes(keys[index]));
  await save("restore original synthetic draft content");
  const restored = await draft(id);
  for (const key of ["display_name", "primary_color", "accent_color", "module_keys"]) assert.deepEqual(restored[key], original[key]);
}
try {
  await page.goto(`${origin}/white-label?tenant=${tenantA}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await ready();
  assert.match(await page.title(), /White Label Studio/);
  if (confirmOnly) {
    for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
    await capture("studio-1440");
    await button("Open Projects preview").click();
    await page.getByRole("button", { name: /Sample item/ }).click();
    await capture("desktop-interactive-1440", page.getByTestId("preview-frame"));
    await button("Mobile").click();
    await button("Workspace overview").click();
    await capture("mobile-preview-1440", page.getByTestId("preview-frame"));
    await capture("mobile-studio-1440");
    await nameField().fill("Long workspace name for responsive preview and navigation QA");
    for (const width of [1440, 1280, 768, 430, 390, 360, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await button("Open preview navigation").click();
      await button("Open Forms preview").click();
      await page.getByRole("button", { name: /Sample item/ }).click();
      assert.equal(await page.getByTestId("preview-frame").evaluate((element) => element.scrollWidth > element.clientWidth), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await capture(`long-name-mobile-${width}`, page.getByTestId("preview-frame"));
      await page.getByLabel("Forms details", { exact: true }).click();
      await page.getByText("Publication rules and financial safeguards", { exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.getByLabel("Forms details", { exact: true }).click();
      await page.getByText("Publication rules and financial safeguards", { exact: true }).click();
    }
    await button("All Drafts").click();
    await button("Discard and return").click();
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.getByRole("region", { name: "Tenant drafts" }).waitFor();
      await capture(`all-drafts-${width}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    evidence.checks.push("final visual confirmation: long name, phone details, all seven widths, expanded module help/safeguards, All Drafts desktop/mobile");
  } else {
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  for (const width of flowsOnly ? [] : [1440, 1280, 768, 430, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await button("Desktop").click();
    await button("Open Dashboard preview").click();
    await capture(`studio-${width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const colorOrder = await page.getByLabel("Primary color", { exact: true }).boundingBox();
    assert.ok((await page.getByLabel("Accent color", { exact: true }).boundingBox()).y > colorOrder.y);
    const tiles = await page.locator('[class*="moduleTile"]').evaluateAll((elements) => elements.map((element) => ({ x: element.getBoundingClientRect().x, width: element.getBoundingClientRect().width })));
    assert.ok(tiles.every((tile) => tile.x === tiles[0].x && tile.width === tiles[0].width));
    const url = page.url();
    await button("Open Projects preview").click();
    await page.getByRole("button", { name: /Sample item/ }).click();
    assert.equal(await page.getByTestId("preview-greeting").textContent(), "Projects sample");
    assert.equal(page.url(), url);
    await capture(`desktop-interactive-${width}`, page.getByTestId("preview-frame"));
    await button("Mobile").click();
    assert.equal(await page.getByTestId("preview-greeting").textContent(), "Projects sample");
    await capture(`mobile-preview-${width}`, page.getByTestId("preview-frame"));
    await button("Open preview navigation").click();
    await button("Open Forms preview").click();
    assert.equal(await page.getByTestId("preview-greeting").textContent(), "Forms");
    assert.equal(await button("Open preview navigation").getAttribute("aria-expanded"), "false");
    assert.equal(page.url(), url);
    await button("Open preview navigation").click();
    await capture(`mobile-menu-${width}`, page.getByTestId("preview-frame"));
    await page.keyboard.press("Escape");
    assert.equal(await button("Open preview navigation").evaluate((element) => element === document.activeElement), true);
    assert.equal(await page.getByTestId("preview-frame").evaluate((element) => element.scrollWidth > element.clientWidth), false);
    await page.getByRole("button", { name: /^Color template:/ }).click();
    await capture(`template-menu-${width}`);
    await page.keyboard.press("Escape");
    await button("Review Draft").click();
    assert.equal(await page.getByRole("heading", { name: "Review draft", exact: true }).evaluate((element) => element === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await button("Back to editing").click();
    evidence.widths.push({ width, noOverflow: true, singleModuleColumn: true, stackedColors: true, desktopAndMobileInteractive: true, menuEscapeFocus: true, review: true });
    await record();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await button("Desktop").click();
  const destinations = await page.getByRole("group", { name: "Preview navigation", exact: true }).getByRole("button").all();
  const labels = await Promise.all(destinations.map((entry) => entry.getAttribute("aria-label")));
  const url = page.url();
  for (const device of ["Desktop", "Mobile"]) {
    await button(device).click();
    for (const label of labels) {
      if (device === "Mobile") await button("Open preview navigation").click();
      await button(label).click();
      assert.equal(page.url(), url);
      await page.waitForFunction(() => document.querySelector('[data-testid="preview-greeting"]') === document.activeElement);
      assert.equal(await page.getByTestId("preview-greeting").evaluate((element) => element === document.activeElement), true);
    }
  }
  evidence.checks.push(`${labels.length} navigation destinations in each device retain the Studio URL and focus content`);
  await button("Desktop").click();
  await button("Open Projects preview").click();
  await page.getByRole("checkbox", { name: "Services", exact: true }).uncheck();
  assert.match(await page.getByTestId("preview-greeting").textContent(), /Welcome to/);
  await page.getByText("Hidden until Services is on.", { exact: true }).first().waitFor();
  assert.equal(await button("Open Projects preview").count(), 0);
  await page.getByRole("checkbox", { name: "Services", exact: true }).check();
  await page.getByLabel("Primary color", { exact: true }).fill("#nope");
  assert.equal(await button("Save Draft").isDisabled(), true);
  assert.equal(await button("Review Draft").isDisabled(), true);
  await button("Reset to Wolf Forge Default").click();
  for (const template of ["Wolf Forge Default", "Executive Navy", "Modern Sand", "Slate Gold", "Forest Premium", "Minimal Mono"]) {
    await page.getByRole("button", { name: /^Color template:/ }).click();
    await page.getByRole("option", { name: template, exact: true }).click();
  }
  await page.getByLabel("Accent color picker", { exact: true }).fill("#ffffff");
  assert.equal(await page.getByLabel("Accent color", { exact: true }).inputValue(), "#ffffff");
  evidence.checks.push("dependencies, all six templates, invalid hex Save/Review blocking, picker and reset");
  await nameField().fill("Studio polish QA A");
  await save("save synthetic A draft");
  assert.equal((await draft(tenantA)).display_name, "Studio polish QA A");
  assert.deepEqual(await draft(tenantB), baseline.b);
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready();
  assert.equal(await nameField().inputValue(), "Studio polish QA A");
  await selectTenant(tenantB);
  assert.equal(await nameField().inputValue(), baseline.b.display_name);
  await nameField().fill("Studio polish QA B");
  await save("save synthetic B draft");
  await selectTenant(tenantA);
  assert.equal(await nameField().inputValue(), "Studio polish QA A");
  await button("All Drafts").click();
  await page.getByRole("region", { name: "Tenant drafts" }).waitFor();
  await capture("all-drafts-1440");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("region", { name: "Tenant drafts" }).waitFor();
  assert.equal(await page.getByText("Studio polish QA A", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Studio polish QA B", { exact: true }).count(), 1);
  await page.getByRole("button", { name: /Continue Editing Builder QA Tenant A/ }).click();
  await ready();
  await nameField().fill("Unsaved local change");
  await button("All Drafts").click();
  await page.getByRole("dialog", { name: "Unsaved draft changes" }).waitFor();
  await button("Keep editing").click();
  assert.equal(await nameField().inputValue(), "Unsaved local change");
  await button("All Drafts").click();
  await button("Discard and return").click();
  evidence.checks.push("A/B independent saves, fresh RPC readback, refresh persistence, tenant switching, All Drafts, continue editing and unsaved departure");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${origin}/white-label?tenant=${tenantA}`, { waitUntil: "domcontentloaded" });
  await ready();
  assert.equal(await page.getByTestId("preview-frame").locator('[class*="sidebar"]').first().evaluate((element) => getComputedStyle(element).transitionDuration), "0s");
  evidence.checks.push("reduced motion disables preview transitions");
  }
  assert.deepEqual(evidence.errors, []);
  evidence.status = "PASS";
} catch (error) {
  evidence.status = "FAIL";
  evidence.failure = error.stack;
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await restore(tenantA, baseline.a);
  await restore(tenantB, baseline.b);
  evidence.final = { a: await draft(tenantA), b: await draft(tenantB), runtime: runtime() };
  assert.equal(evidence.final.runtime, baseline.runtime);
  evidence.finishedAt = new Date().toISOString();
  await record();
  await browser.close();
}
