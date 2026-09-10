import { describe, expect, it } from "vitest";
import {
  locateOnPageSeoLinkColumns,
  parseOnPageSeoWorkflowRows,
} from "../domain/operations/on-page-seo-workflow";
import {
  buildOperationsWorkflowMonthOptions,
  resolveOperationsWorkflowMonthSelection,
} from "../lib/integrations/operations-google-sheets";

describe("On-page SEO workflow domain", () => {
  it("parses repeated header blocks and pairs only adjacent status columns", () => {
    const rows = [
      ["Name", "Assigned VA", "SEO Package", "4 Blogs Posted per Month", "Status", "Schema", "Keyword Research", "Status"],
      ["https://client.example/wp-admin", "Jordan", "Platinum", "https://docs.example/blogs", "Done", "Done", "Keyword chip", "Stuck"],
      [],
      ["Local SEO queue"],
      ["Name", "Owner", "People", "Blog Posted", "Status", "Review Callout", "Status"],
      ["Plain Client", "William", "Geraldine", "", "", "https://docs.example/review", "Completed"],
    ];

    const items = parseOnPageSeoWorkflowRows(rows, "OnPage September 2026");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      clientUrl: "https://client.example/wp-admin",
      assignedVa: "Jordan",
      seoPackage: "Platinum",
      completedDeliverables: 2,
      applicableDeliverables: 3,
      normalizedStatus: "stuck",
    });
    expect(items[0]?.deliverables.map((deliverable) => [deliverable.label, deliverable.state])).toEqual([
      ["4 Blogs Posted per Month", "completed"],
      ["Schema", "completed"],
      ["Keyword Research", "stuck"],
    ]);
    expect(items[1]).toMatchObject({ sourceSection: "Local SEO queue", owner: "William", assignedVa: "Geraldine", completedDeliverables: 1, applicableDeliverables: 2, normalizedStatus: "in_progress" });
  });

  it("recovers only real link-bearing columns and translates explicit blocking signals", () => {
    const rows = [
      ["Name", "Logins", "Assigned VA", "PROMPT/ SOP", "ONPAGE AUDIT", "Status"],
      ["Client", "Login chip", "password is incorrect.", "SOP chip", "Audit chip", ""],
    ];
    expect(locateOnPageSeoLinkColumns(rows)).toEqual([0, 1, 3, 4]);
    expect(parseOnPageSeoWorkflowRows(rows, "September")[0]).toMatchObject({
      assignedVa: null,
      assignmentSourceValue: "password is incorrect.",
      normalizedStatus: "stuck",
    });
  });

  it("accepts the workbook's August header with an unlabeled first client column", () => {
    const rows = [
      ["", "Email", "Logins", "Assigned VA", "SEO Package", "4 Blogs Posted per Month", "Status", "Schema", "Podcast Embed"],
      ["https://august.example", "team@example.com", "https://docs.example/login", "Jordan", "Platinum", "https://docs.example/blogs", "Done", "Done", ""],
    ];
    expect(parseOnPageSeoWorkflowRows(rows, "ONPAGE SEO AUGUST 2026")).toHaveLength(1);
  });

  it("builds a normalized month allowlist and resolves duplicate month tabs by workbook order", () => {
    const options = buildOperationsWorkflowMonthOptions([
      { title: "ONPAGE SEO AUGUST 2026", index: 7 },
      { title: "ONPAGE SEO September 2026- F", index: 8 },
      { title: "OnPage   September 2026", index: 9 },
      { title: "CONTENT SEPTEMBER 2026", index: 10 },
      { title: "ONPAGE SEO DEPARTMENT (MAY)", index: 2 },
    ], "ONPAGE");
    expect(options).toEqual([
      { value: "2026-09", label: "September 2026", tabTitle: "OnPage   September 2026" },
      { value: "2026-08", label: "August 2026", tabTitle: "ONPAGE SEO AUGUST 2026" },
    ]);
    expect(resolveOperationsWorkflowMonthSelection(options, "2026-08")?.tabTitle).toContain("AUGUST");
    expect(resolveOperationsWorkflowMonthSelection(options, "invalid")?.value).toBe("2026-09");
  });
});
