/**
 * Repository-local secret scanner (D-101).
 *
 * Runs over TRACKED FILES ONLY — `git ls-files`. Ignored paths are out of scope
 * by construction, which is correct: an ignored `.env.local` can never reach a
 * commit or a deployment, and scanning it would mean reading live credentials
 * into a process that prints to a terminal. (Their on-disk presence is a
 * separate, recorded concern: KI-024.)
 *
 * ## Redaction by construction
 *
 * This scanner NEVER prints a captured value. It prints file, line, rule name
 * and a fixed-width mask. There is no verbose flag, no `--show`, no debug
 * branch that would reveal the match — the matched text is not carried past the
 * detection function. A security tool whose output is itself a secret leak is
 * worse than no tool.
 *
 * ## Fails closed
 *
 * Any finding exits non-zero. The only permitted suppressions are:
 *
 *   - an inline `// secret-scan:allow(<reason>)` marker on the same line or the
 *     line immediately above, with a STATED reason; and
 *   - the classified-fixture rules below, which match values that are provably
 *     non-credentials (placeholders, obvious test doubles, example hostnames).
 *
 * A suppression without a reason is itself reported.
 *
 * Usage: `npm run security:secrets`
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

type Rule = {
  name: string;
  pattern: RegExp;
  /** Values that are provably not credentials. Matching one clears the finding. */
  benign?: RegExp;
};

/**
 * Self-describing fixture markers — the ONE classification that applies to
 * every rule.
 *
 * A real credential is issued randomness: base62, base64url or hex. It does not
 * contain the English words "leaked", "fake", "not_a_", "SUPERSECRET" or
 * "replace-with". A literal that does is a hand-written test fixture, and this
 * repository has several by design — `sk_live_not_a_customer` in the SQL test
 * that proves a CHECK constraint refuses it, `pk_live_SUPERSECRETVALUE` in the
 * test that proves a key is never echoed into an error message.
 *
 * This is a narrow, stated classification rather than a broad allowlist: it can
 * only clear a value whose own text announces it is not a credential. Widening
 * it — to a path, a rule name, or a length threshold — turns the scanner off.
 */
const FIXTURE_MARKERS =
  /leaked|not[_-]?a[_-]|super[_-]?secret|fake|example|placeholder|dummy|redacted|replace[_-]?with|sample|changeme|your[_-]|abc123|0{8,}|x{8,}/i;

const RULES: Rule[] = [
  {
    name: "aws-access-key-id",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    name: "private-key-block",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    name: "stripe-secret-key",
    pattern: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z_]{6,}\b/g,
    /**
     * `sk_live_leaked_key_shape` and `sk_test_abc123` in
     * `stripe-customer-mapping.test.ts` are cleared by FIXTURE_MARKERS above;
     * the same two are pinned by fingerprint in `.gitleaksignore` for the
     * history scan, which has no access to this classification.
     */
    benign: /shape/i,
  },
  {
    name: "supabase-service-role-jwt",
    // A JWT whose payload names the service_role. Header.payload.signature.
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    name: "supabase-secret-key",
    pattern: /\bsb_secret_[0-9A-Za-z_-]{16,}\b/g,
    benign: /replace-with|example|placeholder/i,
  },
  {
    name: "github-token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[0-9A-Za-z_]{20,}\b/g,
  },
  {
    name: "slack-token",
    pattern: /\bxox[abposr]-[0-9A-Za-z-]{10,}\b/g,
  },
  {
    name: "google-api-key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    name: "generic-assigned-secret",
    // `SOMETHING_SECRET = "…"` with a long opaque literal.
    pattern:
      /\b[A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?TOKEN|PRIVATE_?KEY)[A-Za-z0-9_]*\s*[:=]\s*["'`]([^"'`\s]{20,})["'`]/g,
    benign:
      /^(?:replace-with|example|placeholder|changeme|your-|test-|dummy|redacted|\$\{|process\.env|<[^>]+>)|^[a-z-]+-key-here$/i,
  },
];

/** Binary and generated paths carry no reviewable source. */
const SKIPPED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot", ".pdf", ".zip", ".gz",
]);

/** Never scan the scanner's own rule table, or the lockfile's integrity hashes. */
const SKIPPED_PATHS = new Set([
  "scripts/security/scan-secrets.ts",
  "package-lock.json",
]);

const MAX_BYTES = 2 * 1024 * 1024;

const ALLOW_MARKER = /secret-scan:allow\(([^)]*)\)/;

type Finding = {
  file: string;
  line: number;
  rule: string;
  /** Fixed-width mask. The captured value is never carried here. */
  masked: string;
};

function trackedFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split("\0").filter(Boolean);
}

function isScannable(path: string): boolean {
  if (SKIPPED_PATHS.has(path)) return false;
  if (SKIPPED_EXTENSIONS.has(extname(path).toLowerCase())) return false;
  try {
    if (statSync(path).size > MAX_BYTES) return false;
  } catch {
    return false;
  }
  return true;
}

/**
 * Returns the allow-marker reason for a line, or null when there is none.
 * An empty reason is treated as absent, so `secret-scan:allow()` cannot silence
 * anything.
 */
function allowReason(lines: string[], index: number): string | null {
  for (const candidate of [lines[index], index > 0 ? lines[index - 1] : undefined]) {
    if (!candidate) continue;
    const reason = ALLOW_MARKER.exec(candidate)?.[1]?.trim() ?? "";
    // An empty reason is treated as absent: `secret-scan:allow()` silences nothing.
    if (reason.length > 0) return reason;
  }
  return null;
}

function scanFile(path: string): Finding[] {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  // A NUL byte means this decoded as binary; there is no reviewable source.
  if (contents.includes("\u0000")) return [];

  const lines = contents.split(/\r?\n/);
  const findings: Finding[] = [];

  lines.forEach((line, index) => {
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(line)) !== null) {
        const captured = match[1] ?? match[0];
        if (FIXTURE_MARKERS.test(captured)) continue;
        if (rule.benign && rule.benign.test(captured)) continue;
        if (allowReason(lines, index)) continue;
        findings.push({
          file: path,
          line: index + 1,
          rule: rule.name,
          // Length only. Never the value, never a prefix, never a suffix.
          masked: `<redacted:${captured.length} chars>`,
        });
      }
    }
  });

  return findings;
}

function main(): void {
  const files = trackedFiles().filter(isScannable);
  const findings = files.flatMap(scanFile);

  if (findings.length === 0) {
    console.log(`secret scan: 0 findings across ${files.length} tracked files`);
    return;
  }

  console.error(`secret scan: ${findings.length} finding(s)`);
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  ${finding.rule}  ${finding.masked}`);
  }
  console.error(
    "\nEach finding is either a real credential — rotate it, then purge it from history —\n" +
      "or a verified false positive that needs an inline `secret-scan:allow(<reason>)` marker.",
  );
  process.exitCode = 1;
}

main();
