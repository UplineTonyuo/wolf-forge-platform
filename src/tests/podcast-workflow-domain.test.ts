import { describe, expect, it } from "vitest";
import {
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
