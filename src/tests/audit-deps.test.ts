import { describe, expect, it } from "vitest";
import { evaluateAudit } from "../../scripts/security/audit-deps";

const id = "GHSA-fc5q-39xc-vjpf";
const exception = {
  id,
  package: "picomatch",
  reason: "No fixed release",
  evidence: "Build-only package",
  approver: "owner",
  expires: "2026-12-18",
};
const beforeExpiry = new Date("2026-12-17T23:59:59Z");

type Severity = "moderate" | "high" | "critical";
type Advisory = { name: string; dependency: string; severity: Severity; url: string };
type Finding = { name: string; severity: Severity; via: (Advisory | string)[] };

function advisory(name: string, severity: Severity, ghsa: string): Advisory {
  return { name, dependency: name, severity, url: "https://github.com/advisories/" + ghsa };
}

function report(...findings: Finding[]) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: findings.length };
  for (const f of findings) counts[f.severity]++;
  return {
    status: Number(counts.high + counts.critical > 0),
    stdout: JSON.stringify({
      auditReportVersion: 2,
      metadata: { vulnerabilities: counts },
      vulnerabilities: Object.fromEntries(findings.map(finding => [finding.name, finding])),
    }),
  };
}

const picomatch: Finding = { name: "picomatch", severity: "high", via: [advisory("picomatch", "high", id)] };
const glob: Finding = { name: "glob", severity: "moderate", via: [advisory("glob", "moderate", "GHSA-3g3m-2fjr-6pw4")] };
const rollup: Finding = { name: "@rollup/plugin-commonjs", severity: "high", via: ["picomatch", "glob"] };

describe("production dependency audit", () => {
  it("excepts the exact advisory through parent packages and reports moderate findings", () => {
    expect(evaluateAudit(report(picomatch, glob, rollup), [exception], beforeExpiry)).toEqual({
      excepted: [id], blocked: [], moderateCount: 1,
    });
  });

  it("passes with a moderate only", () => {
    expect(evaluateAudit(report(glob), [exception], beforeExpiry)).toEqual({
      excepted: [], blocked: [], moderateCount: 1,
    });
  });

  it("blocks an unrelated high advisory", () => {
    const unrelated = { name: "unrelated", severity: "high" as const, via: [advisory("unrelated", "high", "GHSA-2222-3333-4444")] };
    const result = evaluateAudit(report(picomatch, unrelated), [exception], beforeExpiry);
    expect(result.blocked).toEqual(["unrelated GHSA-2222-3333-4444"]);
  });

  it("blocks a different critical advisory on picomatch", () => {
    const both = { ...picomatch, severity: "critical" as const, via: [
      ...picomatch.via, advisory("picomatch", "critical", "GHSA-2222-3333-4444"),
    ] };
    expect(evaluateAudit(report(both), [exception], beforeExpiry).blocked).toEqual(["picomatch GHSA-2222-3333-4444"]);
  });

  it("does not apply the same ID to a different package", () => {
    const different = { name: "other", severity: "high" as const, via: [advisory("other", "high", id)] };
    expect(evaluateAudit(report(different), [exception], beforeExpiry).blocked).toEqual(["other " + id]);
  });

  it("blocks a critical finding even if it carries the excepted ID", () => {
    const critical = { ...picomatch, severity: "critical" as const, via: [advisory("picomatch", "critical", id)] };
    expect(evaluateAudit(report(critical), [exception], beforeExpiry).blocked).toEqual(["picomatch " + id]);
  });

  it("fails on the UTC expiry date even if the registry no longer reports the advisory", () => {
    expect(() => evaluateAudit(report(), [exception], new Date("2026-12-18T00:00:00Z"))).toThrow(/expired/i);
  });

  it.each([
    { ...exception, id: [id] },
    { ...exception, id: id + " GHSA-2222-3333-4444" },
    { ...exception, expires: "2026-11-31" },
    { ...exception, evidence: "" },
    { ...exception, approver: "somebody else" },
  ])("rejects invalid exception entries", entry => {
    expect(() => evaluateAudit(report(), [entry], beforeExpiry)).toThrow(/exception/i);
  });

  it.each(["not JSON", "{}", '{"auditReportVersion":2,"vulnerabilities":{}}'])("rejects malformed audit output", stdout => {
    expect(() => evaluateAudit({ status: 0, stdout }, [exception], beforeExpiry)).toThrow(/audit/i);
  });

  it.each([
    { error: new Error("spawn failed"), status: null },
    { status: null, signal: "SIGTERM" },
    { status: 2 },
    { status: 1, stdout: '{"error":{"code":"E503","summary":"registry unavailable"}}' },
    { status: 1, stdout: report(glob).stdout },
  ])("rejects npm process or registry failures", result => {
    expect(() => evaluateAudit({ stdout: report(picomatch).stdout, ...result }, [exception], beforeExpiry)).toThrow(/audit/i);
  });

  it("fails when a high dependency has no resolvable advisory", () => {
    expect(() => evaluateAudit(report(rollup), [exception], beforeExpiry)).toThrow(/audit/i);
  });
});