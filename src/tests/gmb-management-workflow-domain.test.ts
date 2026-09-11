import { describe, expect, it } from "vitest";
import {
  locateGmbManagementLinkColumns,
  parseGmbManagementWorkflowRows,
} from "../domain/operations/gmb-management-workflow";

describe("GMB Management workflow domain", () => {
  it("parses full and reduced stacked blocks without treating empty templates as clients", () => {
    const rows = [
      ["Name", "Email", "Logins", "Order #", "SEO Package", "Primary Keyword", "City", "PROMPT/ SOP", "20 GMB CONTENT/IMAGES", "Status", "20 GMB Posted", "Status 1", "Notes"],
      ["https://complete.example", "team@example.com", "https://docs.example/login", "WF-1", "Platinum", "junk removal", "Austin", "https://docs.example/sop", "https://docs.example/content", "Completed", "https://docs.example/posting", "Completed", ""],
      [],
      ["Empty legacy block"],
      ["Website", "Login", "GMB CONTENT", "Status", "20 GMB POSTED", "Status 1"],
      ["Template only"],
      [],
      ["GMB MANAGEMENT ONLY"],
      ["Name", "GMB Content", "Status", "GMB Posted", "Status"],
      ["Paused Client", "Content file", "PAUSE", "Posting file", "PAUSE"],
    ];

    const items = parseGmbManagementWorkflowRows(rows, "SEPTEMBER 2026");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      clientUrl: "https://complete.example",
      seoPackage: "Platinum",
      normalizedStatus: "completed",
      contentStage: { state: "completed", outputUrl: "https://docs.example/content" },
      postingStage: { state: "completed", outputUrl: "https://docs.example/posting" },
    });
    expect(items[1]).toMatchObject({ sourceSection: "GMB MANAGEMENT ONLY", normalizedStatus: "paused" });
  });

  it("uses deterministic blocker, pause, cancellation, completion, and progress precedence", () => {
    const header = ["Name", "GMB CONTENT", "Status", "20 GMB POSTED", "Status 1", "Notes"];
    const rows = [
      header,
      ["Blocked", "Content file", "Completed", "", "", "can't post, need to verify GMB"],
      ["Paused", "Content file", "Cancel", "Posting file", "Cancel", "PAUSED"],
      ["Cancelled", "", "Client dont want GMB", "", "", ""],
      ["Progress", "Content file", "Inprogress", "", "", ""],
    ];
    expect(parseGmbManagementWorkflowRows(rows, "AUGUST 2026").map((item) => item.normalizedStatus)).toEqual([
      "stuck",
      "paused",
      "cancelled",
      "in_progress",
    ]);
  });

  it("locates all real resource columns across header variants", () => {
    const rows = [
      ["Name", "Logins", "PROMPT/ SOP", "GMB CONTENT", "Status", "20 GMB POSTED", "Status 1"],
      [],
      ["Website", "OB Sheet", "Access Granted", "GMB Content", "Status", "GMB Posted", "Status"],
    ];
    expect(locateGmbManagementLinkColumns(rows)).toEqual([0, 1, 2, 3, 5]);
  });
});
