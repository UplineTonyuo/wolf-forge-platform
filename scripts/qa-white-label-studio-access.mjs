import { chromium } from "playwright";
import { createServerClient } from "@supabase/ssr";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const environment = Object.fromEntries((await readFile(".env.local", "utf8")).split(/\r?\n/).map((line) => line.split(/=(.*)/s).slice(0, 2)).filter((entry) => entry.length === 2));
assert.equal(new URL(environment.SUPABASE_URL).hostname, "127.0.0.1");
const origin = "http://127.0.0.1:3013";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
for (const [identity, filename] of [
  ["owner", ".qa-local-credentials.owner-review.json"],
  ["staff", ".qa-local-credentials.tenant-b.json"],
  ["client", ".qa-local-credentials.client.json"],
  ["quick-access", ".qa-local-credentials.json.pa-hold"],
]) {
  const credentials = JSON.parse(await readFile(resolve(process.env.WF_QA_CREDENTIALS_DIRECTORY, filename), "utf8"));
  const cookies = [];
  const auth = createServerClient(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, {
    cookies: { getAll: () => cookies, setAll: (values) => cookies.push(...values) },
  });
  const login = await auth.auth.signInWithPassword(credentials);
  assert.equal(login.error, null, `${identity} credential grant failed`);
  const membership = await auth.rpc("app_current_tenant_membership");
  const entitlement = await auth.rpc("app_is_platform_admin");
  const context = await browser.newContext();
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: origin, httpOnly: true, sameSite: "Lax" })));
  const page = await context.newPage();
  for (const route of ["/white-label", "/settings/white-label"]) {
    await page.goto(`${origin}${route}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => document.readyState === "complete");
    assert.equal(await page.getByRole("heading", { name: "White Label Studio", exact: true }).count(), 0);
    assert.equal(await page.getByLabel("Workspace display name", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "White Label", exact: true }).count(), 0);
    results.push({ identity, role: membership.data?.[0]?.role_name ?? "no Wolf Forge membership", platformAdmin: entitlement.data, route, denied: true, destination: new URL(page.url()).pathname });
  }
  await context.close();
}
await writeFile("docs/qa/white-label-studio/access-results.json", JSON.stringify({ results, draftWrites: false }, null, 2));
await browser.close();
console.log(JSON.stringify(results));
