import { describe, expect, it } from "vitest";
import {
  applyRecoveredStatusHeaders,
  locateBlankHeaderColumnsNeedingStatus,
  locateHeaderRowsMissingStatusColumn,
  looksLikeStatusValidationOptions,
  normalizePodcastStatus,
  parsePodcastWorkflowRows,
} from "../domain/operations/podcast-workflow";

const PRIMARY_HEADER = [
  "Name",
  "Email",
  "Logins",
  "Order #",
  "SEO Package",
  "Primary Keyword",
  "City",
  "PROMPT / SOP",
  "PODCAST LINK",
  "Status 1",
  "Notes",
  "Assigned Va",
];

const SOURCE_MONTH = "PODCAST AUGUST 2026";

describe("normalizePodcastStatus", () => {
  it("maps Completed to Completed", () => {
    expect(normalizePodcastStatus("Completed", null)).toBe("completed");
  });

  it("maps Stuck to Stuck", () => {
    expect(normalizePodcastStatus("Stuck", null)).toBe("stuck");
  });

  it("maps cancelled/canceled (either spelling) to Cancelled", () => {
    expect(normalizePodcastStatus("cancelled", null)).toBe("cancelled");
    expect(normalizePodcastStatus("canceled", null)).toBe("cancelled");
  });

  it("maps Inprogress and In Progress to In Progress", () => {
    expect(normalizePodcastStatus("Inprogress", null)).toBe("in_progress");
    expect(normalizePodcastStatus("In Progress", null)).toBe("in_progress");
  });

  it("maps a blank status to In Progress", () => {
    expect(normalizePodcastStatus("", null)).toBe("in_progress");
    expect(normalizePodcastStatus("   ", null)).toBe("in_progress");
  });

  it("maps Paused to In Progress", () => {
    expect(normalizePodcastStatus("Paused", null)).toBe("in_progress");
  });

  it("overrides to Cancelled when Notes clearly indicates CANCELLED, even if Status says Completed", () => {
    expect(normalizePodcastStatus("Completed", "CANCELLED per client request")).toBe("cancelled");
    expect(normalizePodcastStatus("Completed", "cancelled")).toBe("cancelled");
  });

  it("does not treat an unrelated note as a cancellation", () => {
    expect(normalizePodcastStatus("Completed", "All good, client is happy")).toBe("completed");
  });
});

describe("parsePodcastWorkflowRows", () => {
  it("excludes the source header row from the parsed items", () => {
    const items = parsePodcastWorkflowRows([PRIMARY_HEADER], SOURCE_MONTH);
    expect(items).toHaveLength(0);
  });

  it("normalizes the main Podcast table rows into canonical items", () => {
    const rows = [
      PRIMARY_HEADER,
      [
        "Acme Co", "acme@example.com", "https://logins.example/acme", "WF-1001",
        "Growth", "plumber near me", "Austin", "https://sop.example/acme",
        "https://podcast.example/acme", "Completed", "", "Jordan",
      ],
      [
        "Blair LLC", "blair@example.com", "https://logins.example/blair", "WF-1002",
        "Starter", "hvac repair", "Dallas", "https://sop.example/blair",
        "https://podcast.example/blair", "Stuck", "Waiting on client audio", "Sam",
      ],
    ];

    const items = parsePodcastWorkflowRows(rows, SOURCE_MONTH);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      sourceMonth: SOURCE_MONTH,
      sourceSection: "Podcast SEO",
      clientName: "Acme Co",
      email: "acme@example.com",
      loginUrl: "https://logins.example/acme",
      orderNumber: "WF-1001",
      rawSeoPackage: "Growth",
      workLabel: "Growth 4/4",
      primaryKeyword: "plumber near me",
      city: "Austin",
      promptSopUrl: "https://sop.example/acme",
      podcastUrl: "https://podcast.example/acme",
      normalizedStatus: "completed",
      rawStatus: "Completed",
      notes: null,
      assignedVa: "Jordan",
    });
    expect(items[1]).toMatchObject({
      clientName: "Blair LLC",
      normalizedStatus: "stuck",
      rawStatus: "Stuck",
      notes: "Waiting on client audio",
    });
  });

  it("normalizes a partial partner block with a different, shorter schema", () => {
    const rows = [
      PRIMARY_HEADER,
      ["Acme Co", "acme@example.com", "", "WF-1001", "Growth", "plumber", "Austin", "", "", "Completed", "", "Jordan"],
      [], // blank separator row
      ["Referral Partners"], // section title row — must not become an item
      ["Name", "Status 1", "Notes"], // shorter header for this block
      ["Tiny Client", "In Progress", ""],
    ];

    const items = parsePodcastWorkflowRows(rows, SOURCE_MONTH);

    expect(items).toHaveLength(2);
    const partial = items.find((item) => item.clientName === "Tiny Client");
    expect(partial).toBeDefined();
    expect(partial?.sourceSection).toBe("Referral Partners");
    expect(partial?.normalizedStatus).toBe("in_progress");
    // Everything the shorter block's header never named is tolerated as missing.
    expect(partial?.email).toBeNull();
    expect(partial?.orderNumber).toBeNull();
    expect(partial?.rawSeoPackage).toBeNull();
    expect(partial?.podcastUrl).toBeNull();
    // No SEO Package column in this block's header at all -> the fixed Partnership label, not a blank package.
    expect(partial?.workLabel).toBe("Partnership 10/10");
  });

  it("keeps rawStatus distinguishable from normalizedStatus for Paused", () => {
    const rows = [
      PRIMARY_HEADER,
      ["Acme Co", "", "", "", "", "", "", "", "", "Paused", "", ""],
    ];
    const items = parsePodcastWorkflowRows(rows, SOURCE_MONTH);
    expect(items[0]?.normalizedStatus).toBe("in_progress");
    expect(items[0]?.rawStatus).toBe("Paused");
  });

  it("tolerates missing optional fields without discarding the row", () => {
    const rows = [
      PRIMARY_HEADER,
      ["Solo Client", "", "", "", "", "", "", "", "", "", "", ""],
    ];
    const items = parsePodcastWorkflowRows(rows, SOURCE_MONTH);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      clientName: "Solo Client",
      email: null,
      loginUrl: null,
      orderNumber: null,
      rawSeoPackage: null,
      // The block's header does have an SEO Package column — just a blank value on this row —
      // so this stays null rather than falling back to the fixed Partnership label.
      workLabel: null,
      primaryKeyword: null,
      city: null,
      promptSopUrl: null,
      podcastUrl: null,
      notes: null,
      assignedVa: null,
      normalizedStatus: "in_progress",
      rawStatus: "",
    });
  });

  it("drops a row with no client-identity cell rather than inventing a work item", () => {
    const rows = [
      PRIMARY_HEADER,
      ["", "", "", "", "", "", "", "", "", "Stuck", "orphan status row", ""],
    ];
    expect(parsePodcastWorkflowRows(rows, SOURCE_MONTH)).toHaveLength(0);
  });
});

/**
 * KI: real September 2026 sheet's wide/top Podcast block header row, byte-
 * verified against the live workbook — "Name","","Email","Logins","Order #",
 * "SEO Package","Primary Keyword","City","PROMPT/ SOP","PODCAST LINK","","",
 * "Notes","Assigned Va". Columns K (10) and L (11) are genuinely blank cells
 * in the real sheet (confirmed via `spreadsheets.get`, not a merge), yet
 * column L carries a live `ONE_OF_LIST` data-validation rule with exactly
 * "Completed"/"Inprogress"/"Stuck"/"cancelled"/"Paused" — the real Status
 * dropdown with no header text above it. This is the exact shape that made
 * genuinely Completed rows (seeitgonejunkremoval.com, readysetjunkbayarea.com,
 * trexexpresshauling.com, ...) render as In Progress before this fix.
 */
const WIDE_BLOCK_HEADER = [
  "Name", "", "Email", "Logins", "Order #", "SEO Package", "Primary Keyword",
  "City", "PROMPT/ SOP", "PODCAST LINK", "", "", "Notes", "Assigned Va",
];

describe("locateHeaderRowsMissingStatusColumn / locateBlankHeaderColumnsNeedingStatus", () => {
  it("flags the wide block's header row and its blank columns when Status has no header text", () => {
    const rows = [
      WIDE_BLOCK_HEADER,
      ["Acme Co", "", "acme@example.com", "", "", "Platinum", "", "", "", "podcast title", "podcast link 2", "Completed"],
    ];
    expect(locateHeaderRowsMissingStatusColumn(rows)).toEqual([0]);
    expect(locateBlankHeaderColumnsNeedingStatus(rows)).toEqual([1, 10, 11]);
  });

  it("finds nothing to recover once the header already names Status 1 by text", () => {
    const rows = [PRIMARY_HEADER, ["Acme Co", "", "", "", "", "", "", "", "", "Completed", "", ""]];
    expect(locateHeaderRowsMissingStatusColumn(rows)).toEqual([]);
    expect(locateBlankHeaderColumnsNeedingStatus(rows)).toEqual([]);
  });
});

describe("looksLikeStatusValidationOptions", () => {
  it("recognizes the real dropdown vocabulary found on the live sheet", () => {
    expect(looksLikeStatusValidationOptions(["Completed", "Inprogress", "Stuck", "cancelled", "Paused"])).toBe(true);
  });

  it("rejects a single-value dropdown (a department tag, e.g. the real sheet's own 'PODS' column)", () => {
    expect(looksLikeStatusValidationOptions(["PODS"])).toBe(false);
  });

  it("rejects an unrelated multi-value dropdown (VA names)", () => {
    expect(looksLikeStatusValidationOptions(["LayLay", "Rap", "Anthony", "Kyle"])).toBe(false);
  });

  it("rejects an empty option list", () => {
    expect(looksLikeStatusValidationOptions([])).toBe(false);
  });
});

describe("applyRecoveredStatusHeaders + parsePodcastWorkflowRows — real sheet's wide block with a blank Status header", () => {
  it("[A] recovers Completed for the wide/top block once its data-validation-confirmed Status column is labeled", () => {
    const rows = [
      WIDE_BLOCK_HEADER,
      ["Acme Co", "", "acme@example.com", "", "", "Platinum", "", "", "", "podcast title", "podcast link 2", "Completed"],
    ];
    const recovered = applyRecoveredStatusHeaders(rows, new Set([11]));
    expect(recovered[0]).toEqual([
      "Name", "", "Email", "Logins", "Order #", "SEO Package", "Primary Keyword",
      "City", "PROMPT/ SOP", "PODCAST LINK", "", "Status", "Notes", "Assigned Va",
    ]);
    const items = parsePodcastWorkflowRows(recovered, SOURCE_MONTH);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ clientName: "Acme Co", normalizedStatus: "completed", rawStatus: "Completed" });
  });

  it("[C] a Cancelled row in the recovered wide block still parses as Cancelled", () => {
    const rows = [
      WIDE_BLOCK_HEADER,
      ["Blair LLC", "", "", "", "", "", "", "", "", "", "", "Cancelled"],
    ];
    const items = parsePodcastWorkflowRows(applyRecoveredStatusHeaders(rows, new Set([11])), SOURCE_MONTH);
    expect(items[0]).toMatchObject({ clientName: "Blair LLC", normalizedStatus: "cancelled", rawStatus: "Cancelled" });
  });

  it("[B] a compact block already naming Status 1 (e.g. Hot Mess Cleanup & Junk Removal's block) still parses Completed, unaffected by the recovery pathway", () => {
    const rows = [["Name", "Status 1"], ["Hot Mess Cleanup & Junk Removal", "Completed"]];
    const items = parsePodcastWorkflowRows(applyRecoveredStatusHeaders(rows, new Set()), SOURCE_MONTH);
    expect(items[0]).toMatchObject({ clientName: "Hot Mess Cleanup & Junk Removal", normalizedStatus: "completed" });
  });

  it("never patches a block whose Status column already resolved by header text, even if a candidate column index is passed in", () => {
    const rows = [PRIMARY_HEADER, ["Acme Co", "", "", "", "", "", "", "", "", "Completed", "", ""]];
    const recovered = applyRecoveredStatusHeaders(rows, new Set([9]));
    expect(recovered).toEqual(rows.map((row) => [...row]));
  });
});
