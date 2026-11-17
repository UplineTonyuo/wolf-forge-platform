import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const severities = ["info", "low", "moderate", "high", "critical"] as const;
type Severity = typeof severities[number];
type Cause = { package: string; severity: Severity; id: string | undefined };
type Finding = { severity: Severity; via: (string | Cause)[] };
type AuditProcess = {
  status: number | null;
  stdout: string;
  stderr?: string;
  signal?: string | null;
  error?: unknown;
};

const ghsa = "GHSA-[23456789cfghjmpqrvwx]{4}(?:-[23456789cfghjmpqrvwx]{4}){2}";
const idPattern = new RegExp("^" + ghsa + "$");
const githubUrl = new RegExp("^https://github\\.com/advisories/(" + ghsa + ")$");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeverity(value: unknown): value is Severity {
  return severities.some(severity => severity === value);
}

function badReport(): never {
  throw new Error("Malformed or inconsistent npm audit report.");
}

function approvedExceptions(entries: unknown, now: Date) {
  if (!Array.isArray(entries)) throw new Error("Malformed audit exception list.");

  const approved = new Set<string>();
  const today = now.toISOString().slice(0, 10);
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !idPattern.test(entry.id) ||
        typeof entry.package !== "string" || !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(entry.package) ||
        typeof entry.reason !== "string" || !entry.reason.trim() ||
        typeof entry.evidence !== "string" || !entry.evidence.trim() ||
        entry.approver !== "owner" || typeof entry.expires !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) {
      throw new Error("Malformed audit exception entry.");
    }
    const end = new Date(entry.expires + "T00:00:00Z");
    if (!Number.isFinite(end.getTime()) || end.toISOString().slice(0, 10) !== entry.expires) {
      throw new Error("Invalid audit exception expiry date.");
    }
    if (today >= entry.expires) throw new Error(`Audit exception ${entry.id} expired on ${entry.expires} UTC.`);
    const key = entry.package + " " + entry.id;
    if (approved.has(key)) throw new Error(`Duplicate audit exception ${key}.`);
    approved.add(key);
  }
  return approved;
}

function parseReport(stdout: string) {
  let report: unknown;
  try {
    report = JSON.parse(stdout);
  } catch {
    return badReport();
  }
  if (isRecord(report) && Object.hasOwn(report, "error")) throw new Error("npm audit returned an error.");
  if (!isRecord(report) || report.auditReportVersion !== 2 || !isRecord(report.vulnerabilities) ||
      !isRecord(report.metadata) || !isRecord(report.metadata.vulnerabilities)) {
    return badReport();
  }

  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  const findings = new Map<string, Finding>();
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    if (!isRecord(entry) || entry.name !== name || !isSeverity(entry.severity) ||
        !Array.isArray(entry.via) || !entry.via.length) return badReport();

    const via = entry.via.map((reason: unknown) => {
      if (typeof reason === "string" && reason) return reason;
      if (!isRecord(reason) || reason.name !== name || reason.dependency !== name ||
          !isSeverity(reason.severity) || typeof reason.url !== "string" || !reason.url) return badReport();
      return { package: name, severity: reason.severity, id: githubUrl.exec(reason.url)?.[1] };
    });
    counts[entry.severity]++;
    findings.set(name, { severity: entry.severity, via });
  }
  const reportedCounts = report.metadata.vulnerabilities;
  if (reportedCounts.total !== findings.size ||
      severities.some(severity => reportedCounts[severity] !== counts[severity])) return badReport();

  for (const { via } of findings.values()) {
    if (via.some(cause => typeof cause === "string" && !findings.has(cause))) return badReport();
  }
  return { counts, findings };
}

export function evaluateAudit(processResult: AuditProcess, entries: unknown, now = new Date()) {
  const approved = approvedExceptions(entries, now);
  // npm exits 1 for findings at the configured threshold as well as errors.
  if (processResult.error || processResult.signal ||
      (processResult.status !== 0 && processResult.status !== 1) ||
      /^npm (?:error|ERR!)/im.test(processResult.stderr ?? "")) {
    throw new Error("npm audit did not complete successfully.");
  }
  const { counts, findings } = parseReport(processResult.stdout);
  if (processResult.status !== Number(counts.high + counts.critical > 0)) return badReport();

  const excepted = new Set<string>();
  const blocked = new Set<string>();
  for (const [name, finding] of findings) {
    const pending = [name];
    const visited = new Set<string>();
    let maximum = -1;
    while (pending.length) {
      const next = pending.pop()!;
      if (visited.has(next)) continue;
      visited.add(next);
      for (const cause of findings.get(next)!.via) {
        if (typeof cause === "string") {
          pending.push(cause);
          continue;
        }
        maximum = Math.max(maximum, severities.indexOf(cause.severity));
        if (cause.severity !== "high" && cause.severity !== "critical") continue;
        const label = cause.package + " " + (cause.id ?? "(unidentified advisory)");
        if (cause.severity === "high" && approved.has(label)) excepted.add(cause.id!);
        else blocked.add(label);
      }
    }
    if (maximum < severities.indexOf(finding.severity)) return badReport();
  }
  return { excepted: [...excepted].sort(), blocked: [...blocked].sort(), moderateCount: counts.moderate };
}

if (import.meta.main) {
  try {
    const npm = process.env.npm_execpath;
    if (!npm) throw new Error("Run this check with npm run audit:deps.");
    const entries: unknown = JSON.parse(readFileSync(new URL("../../security/audit-exceptions.json", import.meta.url), "utf8"));
    const result = spawnSync(process.execPath, [npm, "audit", "--omit=dev", "--json", "--audit-level=high"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    });
    const audit = evaluateAudit(result, entries);
    for (const id of audit.excepted) console.log("Excepted advisory " + id);
    for (const label of audit.blocked) console.error("Blocking advisory " + label);
    console.log(`npm audit reports ${audit.moderateCount} moderate package findings.`);
    if (audit.blocked.length) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Dependency audit gate failed.");
    process.exitCode = 1;
  }
}