import { chromium } from "playwright";
import { createServerClient } from "@supabase/ssr";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import assert from "node:assert/strict";

// V5 Studio acceptance against the isolated Builder QA stack only (API 57321 / DB 57322).
const phase = process.env.WF_V5_QA_PHASE ?? "shot";
assert.ok(["shot", "full", "probe"].includes(phase));
const origin = "http://127.0.0.1:3015";
const output = resolve("docs/qa/white-label-studio-v5");
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
const runtimeCounts = () => sql("select json_build_object('publications',(select count(*) from private.tenant_module_publications),'invoices',(select count(*) from public.invoices),'walletTransactions',(select count(*) from public.company_wallet_transactions))");
const baseline = { a: await draft(tenantA), b: await draft(tenantB), runtime: runtimeCounts() };
const evidence = { phase, origin, startedAt: new Date().toISOString(), baseline, widths: [], presets: [], modules: [], checks: [], attempts: [], errors: [], consoleErrors: [] };
await mkdir(output, { recursive: true });
async function record() { await writeFile(`${output}/${phase}-results.json`, JSON.stringify(evidence, null, 2)); }
await record();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: origin, httpOnly: true, sameSite: "Lax" })));
const page = await context.newPage();
page.on("pageerror", (error) => evidence.errors.push(error.message));
page.on("console", (entry) => { if (entry.type() === "error") evidence.consoleErrors.push(entry.text()); });
evidence.failedResponses = [];
page.on("response", (response) => { if (response.status() >= 400) evidence.failedResponses.push({ status: response.status(), url: response.url(), method: response.request().method() }); });
const button = (name, scope = page) => scope.getByRole("button", { name, exact: true });
const nameField = () => page.getByLabel("Workspace display name");
const live = () => page.getByRole("region", { name: "Live preview", exact: true });
const moduleSwitch = (label) => live().getByRole("switch", { name: `${label} module`, exact: true });
async function settle() { await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})))); }
async function ready() {
  await nameField().waitFor({ timeout: 90000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((element) => element.textContent === "Mobile" && Object.keys(element).some((key) => key.startsWith("__reactProps$") && typeof element[key]?.onClick === "function")));
}
async function shot(name, options = {}) { await settle(); await page.screenshot({ path: `${output}/${name}.png`, ...options }); }
const noPageOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const MODULES = ["Services", "Projects", "Tickets", "Reporting", "Invoices", "Subscriptions", "Coupons", "Investment Intent", "Forms"];
try {
  await page.goto(`${origin}/white-label?tenant=${tenantA}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await ready();
  assert.match(await page.title(), /White Label Studio/);
  assert.equal(await page.getByRole("button", { name: /^Tenant:/ }).count(), 0);
  assert.equal(await page.getByText("Simulated agency workspace").count(), 0);
  await shot("desktop-1440");
  await shot("desktop-1440-full", { fullPage: true });
  await button("Mobile").click();
  await shot("mobile-1440");
  await button("Desktop").click();
  if (phase === "shot") { evidence.status = "SHOT"; }
  else if (phase === "probe") {
    await moduleSwitch("Invoices").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => ({ label: document.activeElement?.getAttribute("aria-label"), outline: getComputedStyle(document.activeElement).outlineStyle, width: getComputedStyle(document.activeElement).outlineWidth, visible: document.activeElement?.matches(":focus-visible") }));
    evidence.keyboardFocus = focused;
    assert.equal(focused.label, "Subscriptions module");
    assert.equal(focused.outline, "solid");
    await shot("keyboard-focus-1440", { clip: await live().boundingBox() });
    evidence.urlTrace = [];
    for (let round = 0; round < 3; round += 1) {
      for (const [label, id] of [["B", tenantB], ["A", tenantA]]) {
        await nameField().fill("V5 unsaved check");
        await button("Back to All Drafts").click();
        await button("Keep editing").click();
        await button("Back to All Drafts").click();
        await button("Discard and return").click();
        await page.getByRole("region", { name: "Tenant drafts" }).waitFor();
        await page.getByRole("button", { name: new RegExp(`Continue Editing Builder QA Tenant ${label}`) }).click();
        await ready();
        const samples = [];
        for (let tick = 0; tick < 12; tick += 1) { samples.push(page.url().endsWith(id) ? label : "other"); await page.waitForTimeout(250); }
        evidence.urlTrace.push({ round, label, samples: samples.join(""), shown: await page.getByTestId("studio-tenant").textContent() });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await noPageOverflow(), true);
      await live().locator(".sidebar-navigation").first().screenshot({ path: `${output}/probe-sidebar-${width}.png` });
    }
    evidence.status = "PROBE";
  }
  else {
    const studioURL = page.url();
    const geometry = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector)?.getBoundingClientRect();
      const form = box('form[aria-label="White Label preview settings"]');
      const preview = [...document.querySelectorAll("section")].find((element) => element.querySelector("h2")?.textContent === "Live preview").getBoundingClientRect();
      return { settings: form.width, preview: preview.width, share: preview.width / (form.width + preview.width) };
    });
    evidence.geometry1440 = geometry;
    assert.ok(geometry.share >= 0.72 && geometry.share <= 0.78, `Live preview share ${geometry.share}`);
    const order = await page.evaluate(() => [...document.querySelectorAll('form[aria-label="White Label preview settings"] :is(label, button, .sr-only + *, span)')].map((element) => element.textContent.trim()).filter((text) => /^(Workspace display name|Color template|Primary color|Accent color|Save Draft|Review Draft|All Drafts)$/.test(text)));
    assert.deepEqual([...new Set(order)], ["Workspace display name", "Color template", "Primary color", "Accent color", "Save Draft", "Review Draft", "All Drafts"]);
    evidence.checks.push(`1440 composition: settings ${Math.round(geometry.settings)}px, Live Preview ${Math.round(geometry.preview)}px (${(geometry.share * 100).toFixed(1)}%); control order matches reference`);

    // Nine modules: X/+ in place, dependency blocks, stable row order, URL unchanged.
    const rowOrder = () => live().locator("[data-module]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-module")));
    const initialOrder = await rowOrder();
    const blockedNotice = () => live().locator('[role="status"][data-blocked="true"]');
    for (const label of MODULES) {
      const control = moduleSwitch(label);
      const before = await control.getAttribute("aria-checked");
      await control.click();
      const after = await control.getAttribute("aria-checked");
      const entry = { module: label, before, after, blocked: before === after };
      if (entry.blocked) entry.reason = await blockedNotice().textContent();
      else { await control.click(); assert.equal(await control.getAttribute("aria-checked"), before); }
      assert.deepEqual(await rowOrder(), initialOrder);
      evidence.modules.push(entry);
    }
    if (await moduleSwitch("Projects").getAttribute("aria-checked") === "true") {
      await moduleSwitch("Services").click();
      assert.equal(await moduleSwitch("Services").getAttribute("aria-checked"), "true");
      assert.match(await blockedNotice().textContent(), /needs? Services\. Remove (it|them) first\./);
      evidence.checks.push("Removing Services while dependents are enabled is blocked with an explanation; state preserved");
    }
    const dependents = ["Projects", "Subscriptions", "Coupons", "Investment Intent"];
    const restoreServices = [];
    for (const label of dependents) if (await moduleSwitch(label).getAttribute("aria-checked") === "true") { await moduleSwitch(label).click(); restoreServices.push(label); }
    const servicesWasOn = await moduleSwitch("Services").getAttribute("aria-checked") === "true";
    if (servicesWasOn) await moduleSwitch("Services").click();
    assert.equal(await moduleSwitch("Services").getAttribute("aria-checked"), "false");
    await moduleSwitch("Subscriptions").click();
    assert.equal(await moduleSwitch("Subscriptions").getAttribute("aria-checked"), "false");
    assert.match(await blockedNotice().textContent(), /Subscriptions needs Services\. Add Services first\./);
    assert.equal(await button("Open Projects preview", live()).isDisabled(), true);
    const ghost = await live().locator('[data-module="services"] .sidebar-link').evaluate((element) => getComputedStyle(element).opacity);
    evidence.checks.push(`Adding Subscriptions without Services is blocked; disabled rows stay in place, ghosted (opacity ${ghost}) and cannot open`);
    if (servicesWasOn) await moduleSwitch("Services").click();
    for (const label of restoreServices) await moduleSwitch(label).click();
    assert.equal(page.url(), studioURL);
    const xRotation = await moduleSwitch("Forms").locator("svg").evaluate((element) => getComputedStyle(element).transform);
    evidence.checks.push(`all nine module identifiers toggled in place in the desktop sidebar; enabled glyph transform ${xRotation} (X), restored to the loaded selection`);

    // Keyboard and reduced motion.
    await moduleSwitch("Forms").focus();
    const outline = await moduleSwitch("Forms").evaluate((element) => getComputedStyle(element).outlineStyle);
    await page.keyboard.press("Space");
    assert.equal(await moduleSwitch("Forms").getAttribute("aria-checked"), (evidence.modules.find((entry) => entry.module === "Forms").before === "true") ? "false" : "true");
    await page.keyboard.press("Enter");
    assert.equal(await moduleSwitch("Forms").getAttribute("aria-checked"), evidence.modules.find((entry) => entry.module === "Forms").before);
    evidence.checks.push(`keyboard: Space and Enter toggle a focused module control; focus outline style ${outline}`);
    await button("Mobile").click();
    await button("Open preview navigation", live()).click();
    assert.equal(await live().getByRole("switch").count(), 0);
    await button("Edit modules", live()).click();
    await shot("mobile-edit-mode-1440");
    await moduleSwitch("Reporting").click();
    await moduleSwitch("Reporting").click();
    await page.keyboard.press("Escape");
    assert.equal(await button("Open preview navigation", live()).evaluate((element) => element === document.activeElement), true);
    evidence.checks.push("mobile drawer: Edit modules reveals X/+ controls; Escape closes and returns focus to the trigger");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await button("Desktop").click();
    assert.equal(await moduleSwitch("Forms").locator("svg").evaluate((element) => getComputedStyle(element).transitionDuration), "0s");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    assert.notEqual(await moduleSwitch("Forms").locator("svg").evaluate((element) => getComputedStyle(element).transitionDuration), "0s");
    evidence.checks.push("reduced motion removes the X/+ rotation transition; default motion keeps it");

    // Phone presets change the exact simulated viewport.
    await button("Mobile").click();
    for (const [name, width, height] of [["Samsung Galaxy S24", 360, 780], ["Google Pixel 9", 412, 915], ["iPhone 15 Pro", 393, 852]]) {
      await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
      const viewport = await page.getByTestId("phone-viewport").evaluate((element) => ({ authoredWidth: element.style.width, authoredHeight: element.style.height, computedWidth: getComputedStyle(element).width, computedHeight: getComputedStyle(element).height, zoom: getComputedStyle(element.parentElement).zoom }));
      assert.equal(viewport.authoredWidth, `${width}px`);
      assert.equal(viewport.authoredHeight, `${height}px`);
      assert.ok(Math.abs(parseFloat(viewport.computedWidth) - width) < 0.5 && Math.abs(parseFloat(viewport.computedHeight) - height) < 0.5);
      evidence.presets.push({ name, ...viewport });
      await shot(`preset-${name.toLowerCase().replace(/\s+/g, "-")}`, { clip: await live().boundingBox() });
    }
    await page.getByRole("region", { name: "Mobile preview" }).screenshot({ path: `${output}/mobile-showcase-1440.png` });
    evidence.checks.push("three phone presets set the simulated viewport to 393×852, 360×780 and 412×915 CSS px");

    // Responsive widths.
    for (const width of [1440, 1280, 768, 430, 390, 360, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const result = { width };
      for (const device of ["Desktop", "Mobile"]) {
        await button(device).click();
        await settle();
        result[device] = { pageOverflow: !(await noPageOverflow()), frameOverflow: await page.getByTestId("preview-frame").evaluate((element) => element.scrollWidth > element.clientWidth + 1) };
        assert.equal(result[device].pageOverflow, false, `${device} page overflow at ${width}`);
      }
      await button("Desktop").click();
      await button("Open Projects preview", live()).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="preview-greeting"]') === document.activeElement);
      await button("Workspace overview", live()).click();
      await page.getByRole("button", { name: /^Color template:/ }).click();
      await page.getByRole("listbox").waitFor();
      await shot(`template-menu-${width}`);
      await page.keyboard.press("Escape");
      await shot(`studio-${width}`, { fullPage: true });
      await button("Mobile").click();
      await button("Open preview navigation", live()).click();
      await shot(`mobile-drawer-${width}`);
      await page.keyboard.press("Escape");
      await button("Desktop").click();
      evidence.widths.push(result);
      await record();
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // Back to All Drafts with unsaved changes, Tenant switching, isolation.
    await nameField().fill("V5 unsaved check");
    await button("Back to All Drafts").click();
    await button("Keep editing").click();
    assert.equal(await nameField().inputValue(), "V5 unsaved check");
    await button("Back to All Drafts").click();
    await button("Discard and return").click();
    await page.getByRole("region", { name: "Tenant drafts" }).waitFor();
    await shot("all-drafts-1440");
    await page.getByRole("button", { name: /Continue Editing Builder QA Tenant B/ }).click();
    await ready();
    assert.equal(await nameField().inputValue(), baseline.b.display_name);
    assert.match(page.url(), new RegExp(tenantB));
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready();
    assert.equal(await nameField().inputValue(), baseline.b.display_name);
    await button("Back to All Drafts").click();
    await page.getByRole("button", { name: /Continue Editing Builder QA Tenant A/ }).click();
    await ready();
    assert.equal(await nameField().inputValue(), baseline.a.display_name);
    evidence.checks.push("Back to All Drafts: Keep editing retains edits, Discard and return, Continue Editing B, refresh, back to A");

    // Save through the normal UI, fresh readback, refresh, then restore the original content.
    const formsOn = baseline.a.module_keys.includes("forms");
    for (const step of ["change", "restore"]) {
      const current = await draft(tenantA);
      await nameField().fill(step === "change" ? "V5 save QA" : baseline.a.display_name);
      await moduleSwitch("Forms").click();
      const attempt = { operation: `UI save synthetic A (${step})`, expectedRevision: current.revision, urlBeforeSave: page.url() };
      evidence.attempts.push(attempt);
      await record();
      await button("Save Draft").click();
      await page.getByText(`Draft saved · revision ${current.revision + 1}. Nothing was published.`, { exact: true }).waitFor();
      const saved = await draft(tenantA);
      attempt.readback = { revision: saved.revision, name: saved.display_name, forms: saved.module_keys.includes("forms") };
      assert.equal(saved.module_keys.includes("forms"), step === "change" ? !formsOn : formsOn);
      assert.deepEqual(await draft(tenantB), baseline.b);
      await page.reload({ waitUntil: "domcontentloaded" });
      await ready();
      attempt.afterRefresh = { name: await nameField().inputValue(), forms: await moduleSwitch("Forms").getAttribute("aria-checked") };
      assert.equal(attempt.afterRefresh.forms, String(attempt.readback.forms));
      await record();
    }
    evidence.checks.push("UI Save Draft with an X/+ module change: fresh RPC readback and refresh match; original A restored; B byte-identical");

    const sources = await page.evaluate(() => [...new Set(performance.getEntriesByType("resource").map((entry) => entry.name))].filter((url) => url.startsWith(location.origin) && url.includes("/_next/") && url.includes(".js")));
    const served = await Promise.all(sources.map(async (url) => { const bytes = await (await context.request.get(url)).body(); return { url, sha256: createHash("sha256").update(bytes).digest("hex"), marker: bytes.toString().includes("Modules (edit mode)") }; }));
    evidence.servedBundles = served.filter((entry) => entry.marker);
    assert.ok(evidence.servedBundles.length > 0);
    evidence.checks.push("served JS bundle contains the V5 'Modules (edit mode)' marker (latest source, not a stale snapshot)");

    await page.getByRole("heading", { name: "White Label Studio" }).scrollIntoViewIfNeeded();
    await shot("final-desktop-1440");
    await shot("final-desktop-1440-full", { fullPage: true });
    await button("Mobile").click();
    await shot("final-mobile-1440");
    await page.getByRole("region", { name: "Mobile preview" }).screenshot({ path: `${output}/final-mobile-showcase-1440.png` });
    assert.deepEqual(evidence.errors, []);
    evidence.status = "PASS";
  }
} catch (error) {
  evidence.status = "BLOCKED";
  evidence.failure = error.stack;
  await page.screenshot({ path: `${output}/${phase}-failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  evidence.final = { a: await draft(tenantA), b: await draft(tenantB), runtime: runtimeCounts() };
  if (phase === "full") {
    for (const key of ["display_name", "primary_color", "accent_color", "module_keys"]) assert.deepEqual(evidence.final.a[key], baseline.a[key]);
    assert.deepEqual(evidence.final.b, baseline.b);
    assert.equal(evidence.final.runtime, baseline.runtime);
  }
  evidence.finishedAt = new Date().toISOString();
  await record();
  await browser.close();
}
