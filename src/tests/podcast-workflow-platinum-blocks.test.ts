import { describe, expect, it } from "vitest";
import { parsePodcastWorkflowRows } from "../domain/operations/podcast-workflow";

/**
 * Focused fixtures for the block-header-driven parser, matching the two real
 * shapes seen in the "PODCAST AUGUST 2026" tab: the full main table, and the
 * much smaller Platinum partner block that follows it with its own local
 * header. Each block must be read against its own column map — never the
 * main table's positions, and never inheriting a field the local header
 * never named.
 */

const SOURCE_MONTH = "PODCAST AUGUST 2026";

const MAIN_HEADER = [
  "Name",
  "Email",
  "Logins",
  "Order #",
  "SEO Package",
  "Primary Keyword",
  "City",
  "PROMPT/SOP",
  "PODCAST LINK",
  "Status 1",
  "Notes",
  "Assigned Va",
];

/** The compact schema Platinum/partner blocks use — a subset of the main columns, in their own order. */
const PLATINUM_HEADER = ["Name", "PODCAST LINK", "Status 1", "Assigned Va"];

describe("parsePodcastWorkflowRows — fixture A: the full main Podcast block", () => {
  it("reads every main-table column at its own position", () => {
    const rows = [
      MAIN_HEADER,
      [
        "Acme Co",
        "acme@example.com",
        "https://logins.example/acme",
        "WF-1001",
        "Growth",
        "plumber near me",
        "Austin",
        "https://sop.example/acme",
        "https://podcast.example/acme",
        "Completed",
        "",
        "Jordan",
      ],
      [
        "Blair LLC",
        "blair@example.com",
        "https://logins.example/blair",
        "WF-1002",
        "Starter",
        "hvac repair",
        "Dallas",
        "https://sop.example/blair",
        "https://podcast.example/blair",
        "Stuck",
        "Waiting on client audio",
        "Sam",
      ],
    ];

    const items = parsePodcastWorkflowRows(rows, SOURCE_MONTH);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
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
      notes: "Waiting on client audio",
      assignedVa: "Sam",
    });
  });
});

describe("parsePodcastWorkflowRows — fixture B: the compact Platinum partner block", () => {
  it("reads a Platinum row with only Name, Podcast Link, Status, and Assigned VA — nothing shifted, nothing inherited", () => {
    const rows = [
      MAIN_HEADER,
      [
        "Acme Co", "acme@example.com", "", "WF-1001", "Growth", "plumber", "Austin",
        "", "https://podcast.example/acme", "Completed", "", "Jordan",
      ],
      [],
      ["PLATINUM PARTNERS"],
      PLATINUM_HEADER,
      ["Ridgeline Plumbing", "https://podcast.example/ridgeline", "In Progress", "Sam"],
      ["Coastal Roofing", "https://podcast.example/coastal", "Stuck", "Priya"],
    ];

    const items = parsePodcastWorkflowRows(rows, SOURCE_MONTH);

    expect(items).toHaveLength(3);

    const ridgeline = items.find((item) => item.clientName === "Ridgeline Plumbing");
    expect(ridgeline).toBeDefined();
    expect(ridgeline?.sourceSection).toBe("PLATINUM PARTNERS");
    expect(ridgeline).toMatchObject({
      podcastUrl: "https://podcast.example/ridgeline",
      normalizedStatus: "in_progress",
      rawStatus: "In Progress",
      assignedVa: "Sam",
    });
    // Never inherited from the main block's schema/positions, and never invented.
    expect(ridgeline?.email).toBeNull();
    expect(ridgeline?.loginUrl).toBeNull();
    expect(ridgeline?.orderNumber).toBeNull();
    expect(ridgeline?.rawSeoPackage).toBeNull();
    expect(ridgeline?.primaryKeyword).toBeNull();
    expect(ridgeline?.city).toBeNull();
    expect(ridgeline?.promptSopUrl).toBeNull();
    expect(ridgeline?.notes).toBeNull();
    // No SEO Package column in this block's header at all -> the fixed Partnership label.
    expect(ridgeline?.workLabel).toBe("Partnership 10/10");

    const coastal = items.find((item) => item.clientName === "Coastal Roofing");
    expect(coastal).toMatchObject({
      podcastUrl: "https://podcast.example/coastal",
      normalizedStatus: "stuck",
      assignedVa: "Priya",
    });
  });

  it("keeps multiple differently-shaped Platinum blocks independent of each other and of the main table", () => {
    const rows = [
      MAIN_HEADER,
      ["Acme Co", "acme@example.com", "", "WF-1001", "Growth", "plumber", "Austin", "", "", "Completed", "", "Jordan"],
      [],
      ["PLATINUM PARTNERS"],
      PLATINUM_HEADER,
      ["Ridgeline Plumbing", "https://podcast.example/ridgeline", "In Progress", "Sam"],
      [],
      ["REFERRAL PARTNERS"],
      ["Name", "Status 1"], // an even smaller two-column block
      ["Tiny Referral Co", "Stuck"],
    ];

    const items = parsePodcastWorkflowRows(rows, SOURCE_MONTH);

    expect(items).toHaveLength(3);

    const referral = items.find((item) => item.clientName === "Tiny Referral Co");
    expect(referral?.sourceSection).toBe("REFERRAL PARTNERS");
    expect(referral?.normalizedStatus).toBe("stuck");
    // The referral block's header never named a Podcast Link or Assigned VA column —
    // the previous (Platinum) block's column positions must not leak into this one.
    expect(referral?.podcastUrl).toBeNull();
    expect(referral?.assignedVa).toBeNull();

    const ridgeline = items.find((item) => item.clientName === "Ridgeline Plumbing");
    expect(ridgeline?.podcastUrl).toBe("https://podcast.example/ridgeline");
  });

  it("does not shift a Podcast Link into Email or a Status into another field when the compact header reorders columns", () => {
    // A compact block whose header lists Status before Podcast Link — the
    // reverse order from the main table — must still map by header text,
    // never by fixed column index.
    const rows = [
      MAIN_HEADER,
      ["Acme Co", "acme@example.com", "", "WF-1001", "Growth", "plumber", "Austin", "", "", "Completed", "", "Jordan"],
      ["Name", "Status 1", "PODCAST LINK", "Assigned Va"],
      ["Summit Dental", "In Progress", "https://podcast.example/summit", "Priya"],
    ];

    const items = parsePodcastWorkflowRows(rows, SOURCE_MONTH);
    const summit = items.find((item) => item.clientName === "Summit Dental");

    expect(summit).toMatchObject({
      rawStatus: "In Progress",
      podcastUrl: "https://podcast.example/summit",
      assignedVa: "Priya",
      email: null,
    });
  });
});
