import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GoogleSheetsTechnicalSeoWorkflowSource, TechnicalSeoSourceUnavailableError } from "../lib/integrations/technical-seo-workflow-source";
import { TechnicalSeoWorkflowService } from "../services/technical-seo-workflow-service";
import { parseTechnicalSeoWorkflowRows } from "../domain/operations/technical-seo-workflow";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = { GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "qa@example.com", GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), TECHNICAL_SEO_SPREADSHEET_ID: "technical-fixture" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe("Technical SEO source and service", () => {
  it("uses scoped month discovery, shared duplicate ranking, cached reads, and one batched hyperlink/chip read", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input); calls.push({ url, init });
      if (url.includes("oauth2")) return json({ access_token: "fixture", expires_in: 3600 });
      if (url.includes("fields=sheets.properties")) return json({ sheets: [
        { properties: { title: "Technical SEO SEPTEMBER 2026", index: 1 } },
        { properties: { title: "  TECHNICAL   SEO September 2026 ", index: 4 } },
        { properties: { title: "TECHNICAL SEO JUNE 2026", index: 2 } },
        { properties: { title: "TECHNICAL SEO DEPARTMENT (JUNE)", index: 8 } },
        { properties: { title: "CONTENT OCTOBER 2026", index: 9 } },
      ] });
      if (url.includes("/values/")) return json({ values: [["Name", "Technical Before", "Status", "Technical After", "Status 1"], ["Client", "Before file", "Done", "After file", ""]] });
      return json({ sheets: [{ data: [
        { startRow: 1, startColumn: 1, rowData: [{ values: [{ chipRuns: [{ chip: { richLinkProperties: { uri: "https://drive.google.com/file/d/before" } } }] }] }] },
        { startRow: 1, startColumn: 3, rowData: [{ values: [{ hyperlink: "https://docs.google.com/document/d/after" }] }] },
      ] }] });
    };
    const source = new GoogleSheetsTechnicalSeoWorkflowSource(env, fetcher);
    const months = await source.listAvailableMonths();
    expect(months.map((month) => month.value)).toEqual(["2026-09", "2026-06"]);
    expect(months[0]!.tabTitle).toBe("  TECHNICAL   SEO September 2026 ");
    const sheet = await source.fetchTab(months[0]!.tabTitle);
    const [item] = parseTechnicalSeoWorkflowRows(sheet.rows, sheet.sourceTab);
    expect(item!.resources.map((resource) => resource.outputUrl)).toEqual(["https://drive.google.com/file/d/before", "https://docs.google.com/document/d/after"]);
    expect(item!.status).toBe("In Progress");
    expect(calls.filter((call) => call.url.includes("chipRuns"))).toHaveLength(1);
    expect(calls.filter((call) => !call.url.includes("oauth2")).every((call) => call.init?.cache === "force-cache")).toBe(true);
  });
  it("does not disguise a failed read as an empty sheet", async () => {
    const source = new GoogleSheetsTechnicalSeoWorkflowSource(env, async (input) => String(input).includes("oauth2") ? json({ access_token: "fixture", expires_in: 3600 }) : json({ error: { status: "PERMISSION_DENIED" } }, 403));
    await expect(source.listAvailableMonths()).rejects.toBeInstanceOf(TechnicalSeoSourceUnavailableError);
    await expect(source.fetchTab("TECHNICAL SEO SEPTEMBER 2026")).rejects.toBeInstanceOf(TechnicalSeoSourceUnavailableError);
  });
  it("allows a genuinely empty month and only fetches an allowlisted title", async () => {
    const fetchTab = vi.fn(async (sourceTab: string) => ({ sourceTab, rows: [] }));
    const service = new TechnicalSeoWorkflowService({ listAvailableMonths: async () => [{ value: "2026-09", label: "September 2026", tabTitle: "TECHNICAL SEO SEPTEMBER 2026" }], fetchTab });
    const result = await service.getSnapshotForMonth("Unrelated private tab");
    expect(fetchTab).toHaveBeenCalledWith("TECHNICAL SEO SEPTEMBER 2026");
    expect(result.items).toEqual([]);
    expect(result.selectedMonth).toBe("2026-09");
  });
  it("treats absence of selectable source tabs as source failure", async () => {
    const service = new TechnicalSeoWorkflowService({ listAvailableMonths: async () => [], fetchTab: vi.fn() });
    await expect(service.getSnapshotForMonth(null)).rejects.toBeInstanceOf(TechnicalSeoSourceUnavailableError);
  });
});
