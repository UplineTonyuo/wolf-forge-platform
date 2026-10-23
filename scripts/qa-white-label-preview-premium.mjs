import { chromium } from "playwright";
import { createServerClient } from "@supabase/ssr";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import assert from "node:assert/strict";

// Browser plugin absent; use installed Playwright and the existing isolated QA identities.
const phase = process.env.WF_SPP_QA_PHASE ?? "after";
const flowOnly = process.env.WF_SPP_QA_FLOW_ONLY === "true";
assert.ok(["before", "after", "final"].includes(phase));
const origin = "http://127.0.0.1:3015";
const output = resolve("docs/qa/white-label-preview-premium");
const qa = resolve(process.env.WF_BUILDER_QA_DIRECTORY);
const tenantA = "c70b73ea-99d9-4c1f-9b0c-f7087a724859";
const tenantB = "c70b73ea-99d9-4c1f-9b0c-f7087a724860";
const env = Object.fromEntries((await readFile(".env.local", "utf8")).split(/\r?\n/).map((line) => line.split(/=(.*)/s).slice(0, 2)).filter((entry) => entry.length === 2));
assert.equal(env.SUPABASE_URL, "http://127.0.0.1:57321");
const container = "supabase_db_Wolf-Forge-Builder-QA-20261012";
function sql(query) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: `begin read only; ${query}; commit;`, encoding: "utf8", windowsHide: true }).trim();
}
const inspected = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8", windowsHide: true }))[0];
assert.equal(inspected.Config.Labels["com.supabase.cli.project"], "Wolf-Forge-Builder-QA-20261012");
assert.equal(inspected.HostConfig.PortBindings["5432/tcp"][0].HostPort, "57322");
assert.equal(sql("select system_identifier::text from pg_control_system()"), "7695498287066267686");
assert.equal(sql("select token::text from wf_builder_qa.identity"), JSON.parse(await readFile(`${qa}/database-identity.json`, "utf8")).probe);
assert.deepEqual(JSON.parse(sql(`select json_agg(slug order by id) from public.tenants where id in ('${tenantA}','${tenantB}')`)), ["builder-qa-a-20261012", "builder-qa-b-20261012"]);
const credentials = JSON.parse(await readFile(`${qa}/private/credentials.json`, "utf8"));
const cookies = [];
const admin = createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => cookies, setAll: (values) => cookies.push(...values) } });
assert.equal((await admin.auth.signInWithPassword(credentials.platformAdmin)).error, null);
assert.equal((await admin.rpc("app_is_platform_admin")).data, true);
async function draft(id) {
  const result = await admin.rpc("app_get_white_label_draft", { p_tenant_id: id });
  assert.equal(result.error, null);
  assert.equal(result.data[0].tenant_id, id);
  return result.data[0];
}
const baseline = { a: await draft(tenantA), b: await draft(tenantB), runtime: sql("select json_build_object('publications',(select count(*) from private.tenant_module_publications),'invoices',(select count(*) from public.invoices),'walletTransactions',(select count(*) from public.company_wallet_transactions))") };
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceHashes = Object.fromEntries(await Promise.all(tracked.filter((path) => path !== "next-env.d.ts").map(async (path) => [path, hash(await readFile(path))])));
const evidence = { phase, origin, startedAt: new Date().toISOString(), baseline, sourceHashes, widths: [], checks: [], attempts: [], errors: [], consoleErrors: [] };
if (flowOnly) {
  const previous = JSON.parse(await readFile(`${output}/after-results.json`, "utf8"));
  evidence.widths = previous.widths;
  evidence.previousVisualRun = { startedAt: previous.startedAt, finishedAt: previous.finishedAt, status: previous.status };
  await writeFile(`${output}/after-initial-workflow-failure.json`, JSON.stringify(previous, null, 2));
}
await mkdir(output, { recursive: true });
async function record() { await writeFile(`${output}/${phase}-results.json`, JSON.stringify(evidence, null, 2)); }
await record();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: origin, httpOnly: true, sameSite: "Lax" })));
const page = await context.newPage();
page.on("pageerror", (error) => evidence.errors.push(error.message));
page.on("console", (entry) => { if (entry.type() === "error") evidence.consoleErrors.push(entry.text()); });
const button = (name) => page.getByRole("button", { name, exact: true });
const nameField = () => page.getByLabel("Workspace display name");
async function ready() {
  await nameField().waitFor({ timeout: 90000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((element) => element.textContent === "Mobile" && Object.keys(element).some((key) => key.startsWith("__reactProps$") && typeof element[key]?.onClick === "function")));
}
async function capture(name, locator = page.getByTestId("preview-frame")) {
  if (flowOnly) return;
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))));
  await locator.screenshot({ path: `${output}/${phase}-${name}.png` });
}
async function navigate(label, mobile = false) {
  if (mobile) await button("Open preview navigation").click();
  await button(`Open ${label} preview`).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="preview-greeting"]') === document.activeElement);
}
try {
  await page.goto(`${origin}/white-label?tenant=${tenantA}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await ready();
  assert.match(await page.title(), /White Label Studio/);
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  await nameField().fill("Wolf Forge Sample Agency");
  await button("Reset to Wolf Forge Default").click();
  await capture("desktop-1440");
  await button("Mobile").click();
  await capture("mobile-1440");
  if (phase === "final") {
    const accepted = JSON.parse(await readFile(`${output}/after-results.json`, "utf8"));
    assert.equal(accepted.status, "PASS");
    for (const path of ["src/components/white-label/white-label-preview.tsx", "src/components/white-label/white-label-builder.module.css", "src/tests/white-label-studio-interactive.test.tsx"]) assert.equal(sourceHashes[path], accepted.sourceHashes[path]);
    assert.equal(await page.getByTestId("preview-workspace").evaluate((element) => getComputedStyle(element).borderTopLeftRadius), "24px");
    await button("Desktop").click();
    assert.equal(await page.getByTestId("preview-frame").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(0, 13, 81)");
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.getByTestId("preview-workspace").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await capture("desktop-scroll-1280");
    await page.getByRole("button", { name: /Client report.*Sample reporting update/ }).click();
    assert.equal(await page.getByTestId("preview-greeting").textContent(), "Reporting");
    evidence.checks.push("post-build dev server renders accepted source hashes, default navy and 24px canvas; lower desktop content remains reachable and interactive");
  }
  if (phase === "after") {
    const before = JSON.parse(await readFile(`${output}/before-results.json`, "utf8"));
    const permitted = new Set(["src/components/white-label/white-label-preview.tsx", "src/components/white-label/white-label-builder.module.css", "src/tests/white-label-studio-interactive.test.tsx"]);
    for (const [path, digest] of Object.entries(before.sourceHashes)) if (!permitted.has(path)) assert.equal(sourceHashes[path], digest, `Protected source changed: ${path}`);
    evidence.checks.push("all tracked source outside the three preview/style/test targets preserved");
    const studioURL = page.url();
    for (const width of flowOnly ? [] : [1440, 1280, 768, 430, 390, 360, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const device of ["Desktop", "Mobile"]) {
        await button(device).click();
        await navigate("Dashboard", device === "Mobile");
        await capture(`${device.toLowerCase()}-${width}`);
        const shape = await page.getByTestId("preview-workspace").evaluate((element) => ({ radius: getComputedStyle(element).borderTopLeftRadius, overflow: element.scrollWidth > element.clientWidth }));
        assert.equal(shape.radius, "24px");
        assert.equal(shape.overflow, false);
        assert.equal(await page.getByTestId("preview-frame").evaluate((element) => element.scrollWidth > element.clientWidth), false);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        for (const label of ["Services", "Projects", "Tickets", "Reporting", "Invoices", "Forms"]) {
          await navigate(label, device === "Mobile");
          assert.equal(page.url(), studioURL);
          assert.equal(await page.getByTestId("preview-workspace").evaluate((element) => getComputedStyle(element).borderTopLeftRadius), "24px");
          assert.equal(await page.getByTestId("preview-greeting").textContent(), label);
        }
        await page.getByRole("button", { name: /Sample item/ }).click();
        assert.equal(await page.getByTestId("preview-greeting").textContent(), "Forms sample");
        await capture(`${device.toLowerCase()}-detail-${width}`);
        if (device === "Mobile") {
          await button("Open preview navigation").click();
          await capture(`mobile-menu-${width}`);
          await page.keyboard.press("Escape");
          assert.equal(await button("Open preview navigation").evaluate((element) => element === document.activeElement), true);
        }
      }
      await page.getByRole("button", { name: /^Color template:/ }).click();
      await page.getByRole("listbox").waitFor();
      await page.keyboard.press("Escape");
      await button("Review Draft").click();
      await page.getByRole("heading", { name: "Review draft", exact: true }).waitFor();
      await button("Back to editing").click();
      evidence.widths.push({ width, desktopAndMobile: true, navigationAndDetail: true, roundedCanvas: true, noOverflow: true, reviewAndTemplateMenu: true });
      await record();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await button("Desktop").click();
    const destinations = await page.getByRole("group", { name: "Preview navigation", exact: true }).getByRole("button").evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label").replace(/^Open | preview$/g, "")));
    for (const device of ["Desktop", "Mobile"]) {
      await button(device).click();
      for (const label of destinations) {
        await navigate(label, device === "Mobile");
        assert.equal(page.url(), studioURL);
        assert.equal(await page.getByTestId("preview-workspace").evaluate((element) => getComputedStyle(element).borderTopLeftRadius), "24px");
      }
    }
    evidence.checks.push(`${destinations.length} supported destinations in both devices keep the shared canvas and Studio URL`);
    await button("Desktop").click();
    await navigate("Dashboard");
    await page.getByRole("button", { name: /^Color template:/ }).click();
    await page.getByRole("option", { name: "Forest Premium", exact: true }).click();
    await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))));
    assert.equal(await page.getByTestId("preview-frame").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(23, 60, 50)");
    await capture("green-gold-desktop");
    await button("Mobile").click();
    await capture("green-gold-mobile");
    await nameField().fill("Long agency workspace identity for narrow phone preview QA");
    await page.setViewportSize({ width: 320, height: 1000 });
    await capture("long-name-mobile-320");
    assert.equal(await page.getByTestId("preview-frame").evaluate((element) => element.scrollWidth > element.clientWidth), false);
    await page.getByLabel("Primary color", { exact: true }).fill("#ffffff");
    assert.equal(await page.getByTestId("preview-frame").evaluate((element) => element.style.getPropertyValue("--preview-on-primary")), "#000d51");
    await page.getByLabel("Primary color", { exact: true }).fill("#nope");
    assert.equal(await button("Save Draft").isDisabled(), true);
    assert.equal(await button("Review Draft").isDisabled(), true);
    await button("Reset to Wolf Forge Default").click();
    await page.getByRole("checkbox", { name: "Services", exact: true }).uncheck();
    await button("Open preview navigation").click();
    assert.equal(await button("Open Projects preview").count(), 0);
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.getByTestId("preview-frame").evaluate((element) => getComputedStyle(element).transitionDuration), "0s");
    evidence.checks.push("draft name, green/gold branding, light-color contrast fallback, hex validation, dependency eligibility and reduced motion");
    await button("All Drafts").click();
    await button("Keep editing").click();
    assert.equal(await nameField().inputValue(), "Long agency workspace identity for narrow phone preview QA");
    await button("All Drafts").click();
    await button("Discard and return").click();
    await page.getByRole("region", { name: "Tenant drafts" }).waitFor();
    await page.getByRole("button", { name: /Continue Editing Builder QA Tenant B/ }).click();
    await ready();
    assert.equal(await nameField().inputValue(), baseline.b.display_name);
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready();
    assert.equal(await nameField().inputValue(), baseline.b.display_name);
    await page.getByRole("button", { name: /^Tenant:/ }).click();
    await page.getByRole("option").filter({ hasText: "Builder QA Tenant A" }).click();
    await ready();
    assert.equal(await nameField().inputValue(), baseline.a.display_name);
    evidence.tenantSwitchURL = page.url();
    evidence.checks.push("All Drafts, Keep editing/Discard protection, Continue Editing B, refresh persistence and switching back to A");
    const sources = await page.evaluate(() => [...new Set([
      ...[...document.querySelectorAll('script[src]')].map((element) => element.src),
      ...performance.getEntriesByType("resource").map((entry) => entry.name),
    ])].filter((url) => url.startsWith(location.origin) && url.includes("/_next/") && url.includes(".js")));
    const served = await Promise.all(sources.map(async (url) => { const response = await context.request.get(url); const bytes = await response.body(); return { url, sha256: hash(bytes), previewMarker: bytes.toString().includes("preview-workspace") }; }));
    evidence.loadedBundles = served;
    await record();
    assert.ok(served.some((entry) => entry.previewMarker));
    evidence.servedBundles = served.filter((entry) => entry.previewMarker);
    evidence.checks.push("served local JS includes the new preview-workspace source marker; computed runtime canvas geometry verified");
    for (const label of ["Preview save QA", baseline.a.display_name]) {
      const current = await draft(tenantA);
      await nameField().fill(label);
      const attempt = { operation: "UI save synthetic A name", expectedRevision: current.revision, displayName: label, urlBeforeSave: page.url() };
      evidence.attempts.push(attempt);
      await record();
      await button("Save Draft").click();
      await page.getByText(`Draft saved · revision ${current.revision + 1}. Nothing was published.`, { exact: true }).waitFor();
      assert.equal((await draft(tenantA)).display_name, label);
      assert.deepEqual(await draft(tenantB), baseline.b);
      attempt.urlAfterSave = page.url();
      await page.reload({ waitUntil: "domcontentloaded" });
      await ready();
      attempt.urlAfterRefresh = page.url();
      attempt.nameAfterRefresh = await nameField().inputValue();
      await record();
      await page.waitForFunction((expected) => document.querySelector('input[maxlength="60"]')?.value === expected, label, { timeout: 10000 });
      assert.equal(await nameField().inputValue(), label);
    }
    evidence.checks.push("normal Save Draft, fresh revision readback and refresh; original A content restored, B unchanged");
  }
  assert.deepEqual(evidence.errors, []);
  evidence.status = "PASS";
} catch (error) {
  evidence.status = "BLOCKED";
  evidence.failure = error.stack;
  await page.screenshot({ path: `${output}/${phase}-failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  const currentA = await draft(tenantA);
  if (currentA.display_name === "Preview save QA") {
    await page.goto(`${origin}/white-label?tenant=${tenantA}`, { waitUntil: "domcontentloaded" });
    await ready();
    await nameField().fill(baseline.a.display_name);
    evidence.attempts.push({ operation: "restore verified temporary synthetic A name", expectedRevision: currentA.revision, displayName: baseline.a.display_name });
    await record();
    await button("Save Draft").click();
    await page.getByText(`Draft saved · revision ${currentA.revision + 1}. Nothing was published.`, { exact: true }).waitFor();
  }
  evidence.final = { a: await draft(tenantA), b: await draft(tenantB) };
  for (const key of ["display_name", "primary_color", "accent_color", "module_keys"]) assert.deepEqual(evidence.final.a[key], baseline.a[key]);
  evidence.final.runtime = sql("select json_build_object('publications',(select count(*) from private.tenant_module_publications),'invoices',(select count(*) from public.invoices),'walletTransactions',(select count(*) from public.company_wallet_transactions))");
  assert.equal(evidence.final.runtime, baseline.runtime);
  assert.deepEqual(evidence.final.b, baseline.b);
  evidence.finishedAt = new Date().toISOString();
  await record();
  await browser.close();
}
