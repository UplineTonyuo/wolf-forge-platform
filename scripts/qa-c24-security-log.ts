/**
 * Local QA for the security monitoring foundation (C2-4).
 *
 * Unit tests prove the classifier, the redactor and the record builder are
 * correct. They cannot prove that a REAL request produces a real log line: that
 * depends on the proxy stamping the correlation header, Next forwarding it to
 * the server action, and the sink reaching the process's stdout — three things
 * only a running production build exercises together.
 *
 * This script drives the actual login form with a deliberately nonexistent
 * account and then reads the server's own log stream back.
 *
 * ## Safety
 *
 * It submits a throwaway address and a throwaway password that belong to
 * nobody. It never prints a captured log line verbatim — `summarize()` is the
 * only formatter and it emits a fixed set of fields — because a QA transcript
 * gets pasted into chat logs. It refuses any base URL that is not loopback, so
 * it cannot be pointed at a hosted environment.
 *
 * It does NOT attempt to trip the provider's rate limit. Doing so would need
 * dozens of real sign-in attempts, and the throttle branch is already proved by
 * `security-monitoring.test.ts`. What is proved here is that the pipeline
 * exists and carries a correlation id.
 *
 * ## Running it
 *
 *   1. npx next build --webpack
 *   2. npx next start --hostname 127.0.0.1 --port 3123  > server.log 2>&1
 *   3. QA_SERVER_LOG=server.log npx tsx scripts/qa-c24-security-log.ts
 */

import { readFileSync } from "node:fs";

const BASE_URL = process.env.QA_BASE_URL ?? "http://127.0.0.1:3123";
const SERVER_LOG = process.env.QA_SERVER_LOG ?? "";

/** Belongs to nobody. `.invalid` is reserved by RFC 2606 and never resolves. */
const THROWAWAY_EMAIL = "c24-qa-nobody@wolf-forge.invalid";
const THROWAWAY_PASSWORD = "c24-qa-not-a-real-password";

const SIGN_IN_FAILURE_MESSAGE = "That email and password don't match an account.";

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, passed: boolean, detail = ""): void {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

interface SecurityRecord {
  log?: string;
  event?: string;
  category?: string;
  severity?: string;
  outcome?: string;
  correlation_id?: string;
  actor_class?: string;
  metadata?: Record<string, unknown>;
}

/** The ONLY formatter. A fixed field set; never the raw line. */
function summarize(entry: SecurityRecord): string {
  return [
    entry.event,
    entry.severity,
    entry.outcome,
    entry.correlation_id ? "correlated" : "uncorrelated",
  ].join(" · ");
}

function assertLoopback(url: string): void {
  const { hostname } = new URL(url);
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error("This QA script only runs against a loopback server.");
  }
}

function readSecurityRecords(): SecurityRecord[] {
  if (!SERVER_LOG) throw new Error("Set QA_SERVER_LOG to the server's captured output file.");

  return readFileSync(SERVER_LOG, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes('"log":"security"'))
    .map((line) => {
      try {
        return JSON.parse(line) as SecurityRecord;
      } catch {
        return {};
      }
    })
    .filter((entry) => entry.log === "security");
}

async function main(): Promise<void> {
  assertLoopback(BASE_URL);

  const before = readSecurityRecords().length;

  const { chromium } = await import("playwright");
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });

    await page.fill('input[name="email"]', THROWAWAY_EMAIL);
    await page.fill('input[name="password"]', THROWAWAY_PASSWORD);
    /*
     * The submit control carries no explicit `type`, so it is matched by its
     * accessible name rather than by an attribute selector that would not hit.
     */
    await page.getByRole("button", { name: "Sign in" }).click();

    /*
     * The banner is rendered by `useActionState`, so it appears only after the
     * action's response has been applied. Wait for the element, then read it —
     * a bare `textContent()` races the re-render.
     */
    /*
     * `.form-banner` specifically, not `[role="alert"]`: the shell renders an
     * empty live region of its own, and `.first()` would match that instead.
     */
    const banner = page.locator('.form-banner[role="alert"]').first();
    const appeared = await banner
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);

    const message = appeared ? ((await banner.textContent()) ?? "") : "";

    record(
      "browser still receives the one non-enumerating message",
      message.includes(SIGN_IN_FAILURE_MESSAGE),
      appeared
        ? `banner text ${message === SIGN_IN_FAILURE_MESSAGE ? "is the exact shared constant" : `differs: ${JSON.stringify(message.slice(0, 80))}`}`
        : `no alert appeared (url ${page.url()})`,
    );
  } finally {
    await browser.close();
  }

  /* Give the stream a moment to flush before reading it back. */
  await new Promise((resolve) => setTimeout(resolve, 750));

  const emitted = readSecurityRecords().slice(before);
  const login = emitted.find((entry) => entry.event?.startsWith("auth.login."));

  record(
    "the sign-in attempt produced a security event",
    Boolean(login),
    login ? summarize(login) : "no auth.login.* record",
  );

  record(
    "an ordinary credential failure is classified as auth.login.failed",
    login?.event === "auth.login.failed",
    login?.event ?? "none",
  );

  record(
    "it is NOT filed as a provider throttle (KI-029 stays distinguishable)",
    login?.event !== "auth.login.rate_limited",
  );

  record(
    "the event carries a request correlation id",
    typeof login?.correlation_id === "string" && /^[0-9a-f]{32}$/.test(login.correlation_id),
  );

  record(
    "the actor class is anonymous and no actor id was invented",
    login?.actor_class === "anonymous" && !("actor_id" in (login ?? {})),
  );

  const raw = JSON.stringify(emitted);
  record(
    "no submitted email reaches the log",
    !raw.includes(THROWAWAY_EMAIL) && !raw.includes("wolf-forge.invalid"),
  );
  record("no submitted password reaches the log", !raw.includes(THROWAWAY_PASSWORD));
  record(
    "no session cookie or bearer token reaches the log",
    !/eyJ[A-Za-z0-9_-]{6,}\./.test(raw) && !/sb-[a-z0-9-]+-auth-token/.test(raw),
  );

  /*
   * Measured over EVERY record in the stream, not just this run's: one sign-in
   * produces one event, so a same-run comparison would pass vacuously and prove
   * nothing about per-request minting.
   */
  const all = readSecurityRecords();
  const correlationIds = new Set(all.map((entry) => entry.correlation_id).filter(Boolean));
  record(
    "each request mints its own correlation id",
    all.length < 2 ? false : correlationIds.size === all.length,
    `${correlationIds.size} distinct id(s) across ${all.length} event(s)`,
  );

  const failed = checks.filter((check) => !check.passed);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
