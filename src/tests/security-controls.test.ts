import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import {
  ENFORCED_CONTENT_SECURITY_POLICY,
  buildReportOnlyContentSecurityPolicy,
  buildSecurityHeaders,
  readSecurityHeaderEnvironment,
  securityHeaderRules,
} from "../lib/security/response-headers";

/**
 * Security Phase C1 + C2-1 control regression suite.
 *
 * These are not behaviour tests for a feature — they pin SECURITY POSTURE, the
 * kind that regresses silently because nothing visibly breaks when it does. A
 * dropped header, an HSTS line that starts firing in development, a source-map
 * flag flipped by a well-meaning debugging session, an error boundary that
 * starts printing a stack: each of those is invisible to every other suite.
 *
 * Two styles are used deliberately:
 *
 *   behaviour   the header builder is a pure function, so its output is
 *               asserted directly for both environments.
 *   source      posture that lives in config or JSX is asserted against the
 *               file text, following the convention already established by
 *               `stripe-customer-mapping.test.ts` and `client-payment-rails`.
 */

const root = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(root, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

const productionEnvironment = { isProduction: true, supabaseUrl: "https://project.supabase.co" };
const developmentEnvironment = { isProduction: false, supabaseUrl: "http://127.0.0.1:54321" };

function headerValue(
  headers: ReturnType<typeof buildSecurityHeaders>,
  key: string,
): string | undefined {
  return headers.find((header) => header.key.toLowerCase() === key.toLowerCase())?.value;
}

describe("security response headers (C1)", () => {
  it("sends the classic hardening headers on every path", () => {
    const headers = buildSecurityHeaders(productionEnvironment);

    expect(headerValue(headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(headerValue(headers, "X-Frame-Options")).toBe("DENY");
    expect(headerValue(headers, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headerValue(headers, "X-DNS-Prefetch-Control")).toBe("off");
    expect(headerValue(headers, "Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  it("denies the powerful browser features this platform never uses", () => {
    const permissions = headerValue(buildSecurityHeaders(productionEnvironment), "Permissions-Policy");

    // An empty allowlist `()` denies the feature to the page and every frame.
    for (const feature of ["camera", "geolocation", "payment", "usb"]) {
      expect(permissions).toContain(`${feature}=()`);
    }
  });

  it("allows microphone for this app's own page only, for the first-party Team voice recorder", () => {
    const permissions = headerValue(buildSecurityHeaders(productionEnvironment), "Permissions-Policy");

    // `(self)` still denies every cross-origin/third-party use; it only
    // unblocks the same-origin getUserMedia() call the voice recorder makes.
    expect(permissions).toContain("microphone=(self)");
    expect(permissions).not.toContain("microphone=()");
  });

  it("applies the whole set to every path through one rule", () => {
    const rules = securityHeaderRules(productionEnvironment);

    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe("/:path*");
    expect(rules[0]?.headers).toEqual(buildSecurityHeaders(productionEnvironment));
  });

  it("enforces only the CSP directives that cannot break rendering", () => {
    // Framing, plugins, <base> hijacking and form exfiltration are independent
    // of how Next emits scripts and styles, so enforcing them is always safe.
    expect(ENFORCED_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(ENFORCED_CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(ENFORCED_CONTENT_SECURITY_POLICY).toContain("base-uri 'self'");
    expect(ENFORCED_CONTENT_SECURITY_POLICY).toContain("form-action 'self'");

    // The enforced stage must NOT carry load-time directives; that is the
    // Report-Only stage's job until KI-023 is settled.
    expect(ENFORCED_CONTENT_SECURITY_POLICY).not.toContain("script-src");
    expect(ENFORCED_CONTENT_SECURITY_POLICY).not.toContain("default-src");
    expect(ENFORCED_CONTENT_SECURITY_POLICY).not.toContain("unsafe-inline");
  });

  it("ships the full load-time policy as Report-Only (KI-023)", () => {
    const headers = buildSecurityHeaders(productionEnvironment);
    const reportOnly = headerValue(headers, "Content-Security-Policy-Report-Only");

    expect(headerValue(headers, "Content-Security-Policy")).toBe(ENFORCED_CONTENT_SECURITY_POLICY);
    expect(reportOnly).toContain("default-src 'self'");
    expect(reportOnly).toContain("script-src");
    expect(reportOnly).toContain("style-src");
    expect(reportOnly).toContain("frame-ancestors 'none'");
  });

  it("puts the Supabase ORIGIN in connect-src and never a key", () => {
    const policy = buildReportOnlyContentSecurityPolicy({
      isProduction: true,
      supabaseUrl: "https://project.supabase.co/rest/v1?apikey=would-be-a-secret",
    });

    expect(policy).toContain("https://project.supabase.co");
    expect(policy).toContain("wss://project.supabase.co");
    // Path, query and anything credential-shaped are dropped by URL.origin.
    expect(policy).not.toContain("apikey");
    expect(policy).not.toContain("would-be-a-secret");
    expect(policy).not.toContain("/rest/v1");
  });

  it("narrows connect-src to self when the Supabase URL is missing or malformed", () => {
    for (const supabaseUrl of [undefined, "", "not a url"]) {
      const policy = buildReportOnlyContentSecurityPolicy({ isProduction: true, supabaseUrl });
      expect(policy).toContain("connect-src 'self'");
    }
  });

  it("sends HSTS in production only, for 180 days, without preload", () => {
    const hsts = headerValue(buildSecurityHeaders(productionEnvironment), "Strict-Transport-Security");

    expect(hsts).toBe(`max-age=${60 * 60 * 24 * 180}; includeSubDomains`);
    // preload is effectively irreversible and stays a human decision (D-101).
    expect(hsts).not.toContain("preload");
  });

  it("never sends HSTS outside production", () => {
    // A dev machine on plain http would pin itself to https for six months.
    const headers = buildSecurityHeaders(developmentEnvironment);
    expect(headerValue(headers, "Strict-Transport-Security")).toBeUndefined();
  });

  it("reads production strictly from NODE_ENV and carries no secret", () => {
    expect(readSecurityHeaderEnvironment({ NODE_ENV: "production" } as NodeJS.ProcessEnv).isProduction).toBe(true);
    for (const value of ["development", "test", undefined]) {
      expect(
        readSecurityHeaderEnvironment({ NODE_ENV: value } as NodeJS.ProcessEnv).isProduction,
      ).toBe(false);
    }

    const environment = readSecurityHeaderEnvironment({
      NODE_ENV: "production",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: "must-never-be-read",
    } as NodeJS.ProcessEnv);
    expect(Object.values(environment)).not.toContain("must-never-be-read");
  });
});

describe("single header authority (D-101)", () => {
  it("applies the headers from next.config.ts and nowhere else", async () => {
    // The production login hardening pass wrapped the config in botid's
    // `withBotId()`, which appends its OWN header rule scoped to its own
    // internal detection path (`botid/next/config`) — additive, not a second
    // authority over the app's own policy. D-101's actual invariant is that
    // our security-header rule set is present, unmodified, and not
    // OVERRIDDEN, so this asserts containment rather than exact equality.
    expect(typeof nextConfig.headers).toBe("function");
    const applied = await nextConfig.headers!();
    const ours = securityHeaderRules(readSecurityHeaderEnvironment());
    expect(applied).toEqual(expect.arrayContaining(ours));
    for (const rule of ours) {
      expect(applied.filter((r) => r.source === rule.source)).toHaveLength(1);
    }
  });

  it("has no vercel.json that could silently duplicate or override them", () => {
    // Two header sources means the deployed policy is whichever one wins, and
    // nobody can tell by reading the repository which that is.
    expect(existsSync(resolve(repositoryRoot, "vercel.json"))).toBe(false);
  });

  it("does not write security headers from the proxy", () => {
    const proxy = read("src/proxy.ts");
    expect(proxy).not.toContain("Content-Security-Policy");
    expect(proxy).not.toContain("Strict-Transport-Security");
    expect(proxy).not.toContain("X-Frame-Options");
  });
});

describe("secret scanning fails closed (C1)", () => {
  const scanner = read("scripts/security/scan-secrets.ts");

  it("scans tracked files, so an ignored .env is never read into a terminal", () => {
    expect(scanner).toContain("git");
    expect(scanner).toContain("ls-files");
  });

  it("never carries a captured value into its output", () => {
    // The mask is built from the LENGTH only. No prefix, no suffix, no slice.
    expect(scanner).toContain("<redacted:${captured.length} chars>");
    expect(scanner).not.toContain("captured.slice");
    expect(scanner).not.toContain("console.log(captured");
    expect(scanner).not.toContain("console.error(captured");
  });

  it("exits non-zero on any finding", () => {
    expect(scanner).toContain("process.exitCode = 1");
  });

  it("refuses a suppression that states no reason", () => {
    // `secret-scan:allow()` with an empty reason must not silence a finding.
    expect(scanner).toContain("reason.length > 0");
    expect(scanner).toContain("secret-scan:allow");
  });

  it("is reachable as an npm script alongside the dependency audit", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["security:secrets"]).toContain("scan-secrets.ts");
    expect(packageJson.scripts["audit:deps"]).toContain("--omit=dev");
    expect(packageJson.scripts["audit:deps"]).toContain("--audit-level=high");
  });
});

describe("security automation is configured (C1)", () => {
  it("keeps dependency updates weekly, grouped, and majors human-reviewed", () => {
    const dependabot = read(".github/dependabot.yml");

    expect(dependabot).toContain("package-ecosystem: npm");
    expect(dependabot).toContain("interval: weekly");
    expect(dependabot).toContain("groups:");
    // A bot-merged major of Next/Supabase/React here breaks auth or rendering.
    expect(dependabot).toContain("version-update:semver-major");
  });

  it("runs independent compile, lint, test, database, dependency, and secret gates", () => {
    const workflow = read(".github/workflows/security.yml");
    const vitestConfig = read("vitest.config.ts");
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

    for (const job of ["typecheck:", "lint:", "tests:", "database:", "dependencies:", "secrets:"]) {
      expect(workflow).toContain(job);
    }
    expect(workflow).not.toContain("continue-on-error");

    expect(workflow).toContain("npx next typegen && npm run typecheck");
    expect(workflow).toContain("npm run lint");
    // The full Vitest discovery pattern is the security-test inventory. CI
    // must not return to a hand-maintained list of a few named test files.
    expect(workflow).toContain("run: npm test");
    expect(workflow).not.toContain("src/tests/");
    expect(vitestConfig).toContain('src/tests/**/*.test.ts');
    expect(vitestConfig).toContain('src/tests/**/*.test.tsx');

    expect(workflow).toContain("npx supabase start --yes");
    expect(workflow).toContain("npm run test:db");
    expect(packageJson.scripts["test:db"]).toContain("--local");
    expect(packageJson.scripts["test:db"]).not.toContain("--linked");

    expect(workflow).toContain("npm run audit:deps");
    expect(workflow).toContain("ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:b109bc5f8f76a38196a3e413704fc5b9e3c32360bce4e4b603bd6f45b3721dbb");
    expect(workflow).toContain("git --redact --no-banner --no-color --verbose /repo");
    // A secret deleted in a later commit is still published; depth 0 is required.
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).not.toContain("--log-opts");
    expect(workflow).toContain("npm run security:secrets");
  });

  it("allows only pinned, reasoned gitleaks suppressions", () => {
    const allowlist = read(".gitleaksignore");
    const entries = allowlist
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      // commit:file:rule:line — a path glob or bare rule name would disable
      // the scanner for future findings rather than triage this one.
      expect(entry.split(":")).toHaveLength(4);
      expect(entry).toMatch(/^[0-9a-f]{40}:/);
      expect(entry).not.toContain("*");
    }
  });
});

describe("production environment hardening (C2-1)", () => {
  it("pins the config flags that keep internals out of the browser", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(nextConfig.devIndicators).toBe(false);
    // Default already, pinned so it is auditable and cannot drift (D-110).
    expect(nextConfig.productionBrowserSourceMaps).toBe(false);
  });

  it("has a root error boundary covering the segments without their own", () => {
    // /account/**, /login and the anonymous form fill previously fell through
    // to Next's unbranded default error page.
    const boundary = read("src/app/error.tsx");
    expect(boundary).toContain('"use client"');
    expect(boundary).toContain("reset");
  });

  it("never renders the caught error's message or stack (D-110)", () => {
    // Next redacts SERVER errors to an opaque digest in production, but a
    // client-side exception still carries its full text in the browser, so
    // printing it would defeat that redaction entirely.
    for (const path of ["src/app/error.tsx", "src/app/(internal)/error.tsx"]) {
      const boundary = read(path);
      expect(boundary).not.toContain("{error.message}");
      expect(boundary).not.toContain("{error.stack}");
      expect(boundary).not.toContain("{error.digest}");
      // Full detail still reaches the console for legitimate diagnostics.
      expect(boundary).toContain("console.error(error)");
    }
  });
});
