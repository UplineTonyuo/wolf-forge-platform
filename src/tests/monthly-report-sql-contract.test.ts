import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { supportedReportingServiceIds } from "../domain/reporting/service-profiles";

const sql = readFileSync("supabase/migrations/20261108080017_monthly_report_completion_gate.sql", "utf8");
it("keeps the database monthly profile allowlist identical to the server registry", () => {
  const registry = sql.slice(sql.indexOf("create function private.is_monthly_reporting_service"), sql.indexOf("-- Subscriptions"));
  const ids = [...registry.matchAll(/'([0-9a-f-]{36})'::uuid/gu)].map((match) => match[1]).sort();
  expect(ids).toEqual([...supportedReportingServiceIds].sort());
});
