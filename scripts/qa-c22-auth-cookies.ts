/**
 * Local QA for the auth-cookie policy (C2-2, D-114).
 *
 * Unit tests prove the helper is correct. They cannot prove the browser
 * actually RECEIVES the attributes — that depends on the library's write path,
 * Next's response handling and the real production build together. This script
 * checks the live jar.
 *
 * ## Safety
 *
 * It prints cookie NAMES and FLAGS only. No cookie value, no token, no
 * Set-Cookie value body is ever written to stdout — `describeCookie` below is
 * the only formatter and it cannot emit one. Do not add a debug branch that
 * does; a QA transcript gets pasted into chat logs and issue trackers.
 *
 * ## Running it
 *
 *   1. npm run build
 *   2. npx next start -p 3100            (NODE_ENV=production, so Secure is on)
 *   3. npx tsx scripts/qa-c22-auth-cookies.ts
 *
 * Requires Playwright and two seeded local fixtures. It is a LOCAL tool: it
 * refuses any base URL that is not loopback, so it can never be pointed at a
 * hosted environment and log a real session's flags.
 */

const BASE_URL = process.env.QA_BASE_URL ?? "http://127.0.0.1:3100";

const INTERNAL_EMAIL = process.env.QA_INTERNAL_EMAIL ?? "";
const INTERNAL_PASSWORD = process.env.QA_INTERNAL_PASSWORD ?? "";
const CLIENT_EMAIL = process.env.QA_CLIENT_EMAIL ?? "";
const CLIENT_PASSWORD = process.env.QA_CLIENT_PASSWORD ?? "";

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, passed: boolean, detail = ""): void {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** The ONLY cookie formatter. Flags and name; never a value. */
function describeCookie(cookie: {
  name: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
  path: string;
}): string {
  return `${cookie.name} httpOnly=${cookie.httpOnly} secure=${cookie.secure} sameSite=${cookie.sameSite} path=${cookie.path}`;
}

function assertLoopback(url: string): void {
  const { hostname } = new URL(url);
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(
      "This QA script is local-only. Pointing it at a hosted environment would log a real session's cookie flags.",
    );
  }
}

async function main(): Promise<void> {
  assertLoopback(BASE_URL);

  if (!INTERNAL_EMAIL || !INTERNAL_PASSWORD) {
    console.error(
      "Set QA_INTERNAL_EMAIL / QA_INTERNAL_PASSWORD (and optionally QA_CLIENT_EMAIL /\n" +
        "QA_CLIENT_PASSWORD) to seeded LOCAL fixtures. Credentials are read from the\n" +
        "environment and never written to this file or to stdout.",
    );
    process.exitCode = 1;
    return;
  }

  const { chromium } = (await import("playwright")) as typeof import("playwright");
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();

  try {
    // ---- gate ------------------------------------------------------------
    const gated = await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    record(
      "LOGIN GATE: unauthenticated /dashboard redirects to /login",
      page.url().includes("/login"),
      `status ${gated?.status() ?? "?"}`,
    );

    // ---- login -----------------------------------------------------------
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', INTERNAL_EMAIL);
    await page.fill('input[name="password"]', INTERNAL_PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 }),
      page.click('.login-submit'),
    ]);
    record("LOGIN: internal sign-in lands authenticated", !page.url().includes("/login"));

    // ---- cookie flags, from the real jar ---------------------------------
    const authCookies = (await context.cookies()).filter((cookie) => cookie.name.startsWith("sb-"));
    record("COOKIE: a Supabase session cookie exists", authCookies.length > 0, `${authCookies.length} chunk(s)`);
    for (const cookie of authCookies) {
      record(`COOKIE FLAGS: ${cookie.name}`, cookie.httpOnly, describeCookie(cookie));
    }
    record(
      "COOKIE: Secure matches the environment",
      authCookies.every((cookie) => cookie.secure === (process.env.NODE_ENV === "production")),
      `NODE_ENV=${process.env.NODE_ENV ?? "unset"}`,
    );
    record(
      "COOKIE: SameSite and Path preserved",
      authCookies.every((cookie) => cookie.sameSite === "Lax" && cookie.path === "/"),
    );

    // ---- token leakage ---------------------------------------------------
    const documentCookie = await page.evaluate(() => document.cookie);
    record(
      "TOKEN LEAKAGE: no sb-* entry is visible to document.cookie",
      !documentCookie.includes("sb-"),
      `${documentCookie.length} chars visible to script`,
    );

    // ---- session survives navigation ------------------------------------
    const protectedPage = await page.goto("/invoices", { waitUntil: "domcontentloaded" });
    record(
      "SESSION: a protected route renders signed-in after navigation",
      !page.url().includes("/login") && (protectedPage?.status() ?? 0) < 400,
    );

    // ---- logout ----------------------------------------------------------
    // Sign out lives inside the account popover, which is collapsed until its
    // avatar trigger is clicked. Driving the real control (rather than posting
    // the action directly) is the point: it exercises the same write path a
    // user's logout takes, which is what has to clear every cookie chunk.
    await page.click('button.avatar-button[aria-label="Account"]');
    const signOut = page.locator('form button[role="menuitem"]:has-text("Sign out")').first();
    await signOut.waitFor({ state: "visible", timeout: 10_000 });
    await Promise.all([page.waitForURL(/\/login/, { timeout: 20_000 }), signOut.click()]);

    const afterLogout = (await context.cookies()).filter((cookie) => cookie.name.startsWith("sb-"));
    record("LOGOUT: lands on /login", page.url().includes("/login"));
    record(
      "LOGOUT: zero sb-* cookies remain",
      afterLogout.length === 0,
      `${afterLogout.length} remaining`,
    );

    // ---- post-logout gates ----------------------------------------------
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    record("STALE AUTH: /dashboard re-rejects after logout", page.url().includes("/login"));
    await page.goto("/invoices", { waitUntil: "domcontentloaded" });
    record("STALE AUTH: /invoices re-rejects after logout", page.url().includes("/login"));

    // ---- open redirect ---------------------------------------------------
    await page.goto("/login?next=https://evil.example/", { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', INTERNAL_EMAIL);
    await page.fill('input[name="password"]', INTERNAL_PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 }),
      page.click('.login-submit'),
    ]);
    record(
      "OPEN REDIRECT: an off-origin next target is discarded",
      new URL(page.url()).hostname === new URL(BASE_URL).hostname,
      new URL(page.url()).pathname,
    );

    // ---- client surface separation --------------------------------------
    if (CLIENT_EMAIL && CLIENT_PASSWORD) {
      const clientContext = await browser.newContext({ baseURL: BASE_URL });
      const clientPage = await clientContext.newPage();
      await clientPage.goto("/login", { waitUntil: "domcontentloaded" });
      await clientPage.fill('input[name="email"]', CLIENT_EMAIL);
      await clientPage.fill('input[name="password"]', CLIENT_PASSWORD);
      await Promise.all([
        clientPage.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 }),
        clientPage.click('.login-submit'),
      ]);
      record("CLIENT LOGIN: portal account lands in /account", clientPage.url().includes("/account"));

      await clientPage.goto("/dashboard", { waitUntil: "domcontentloaded" });
      record(
        "FIXATION/STALE AUTH: a client session is refused the internal surface",
        !clientPage.url().endsWith("/dashboard"),
        new URL(clientPage.url()).pathname,
      );

      const clientCookies = (await clientContext.cookies()).filter((cookie) => cookie.name.startsWith("sb-"));
      record(
        "COOKIE: the client session cookie is HttpOnly too",
        clientCookies.length > 0 && clientCookies.every((cookie) => cookie.httpOnly),
      );
      await clientContext.close();
    } else {
      console.log("SKIP  client-surface checks (QA_CLIENT_EMAIL / QA_CLIENT_PASSWORD unset)");
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const failed = checks.filter((check) => !check.passed);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    for (const check of failed) console.error(`  FAILED: ${check.name}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  // The message only; a stack here could carry a URL with a query string.
  console.error(`QA run failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
