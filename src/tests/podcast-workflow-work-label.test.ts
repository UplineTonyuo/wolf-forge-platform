import { describe, expect, it } from "vitest";
import { abbreviatePackageLabel, parsePodcastWorkflowRows } from "../domain/operations/podcast-workflow";

/**
 * The derived Work label (`workLabel`) is decided from whether the *local
 * block's header* has an SEO Package column at all — never from client
 * name, VA, status, row number, Podcast Link presence, or section title.
 * These fixtures match the shapes actually seen in the sheet.
 */

const SOURCE_MONTH = "PODCAST AUGUST 2026";

const FULL_HEADER = [
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

describe("workLabel — full block (has an SEO Package column)", () => {
  it.each([
    ["Platinum", "Platinum 4/4"],
    ["Basic SEO", "Basic SEO 4/4"],
    ["SEO Success Blueprint", "SBP 4/4"],
    ["SEO Success Blueprint (50 Targeted Keywords)", "SBP (50 Targeted Keywords) 4/4"],
    ["Platinum SEO Success Blueprint", "Platinum SBP 4/4"],
    ["Platinum SEO Success Blueprint (100 Targeted Keywords)", "Platinum SBP (100 Targeted Keywords) 4/4"],
  ])("derives %j -> %j and preserves the raw value untouched", (rawPackage, expectedWorkLabel) => {
    const rows = [
      FULL_HEADER,
      ["Acme Co", "acme@example.com", "", "WF-1001", rawPackage, "plumber", "Austin", "", "", "Completed", "", "Jordan"],
    ];

    const [work] = parsePodcastWorkflowRows(rows, SOURCE_MONTH);

    expect(work?.rawSeoPackage).toBe(rawPackage);
    expect(work?.workLabel).toBe(expectedWorkLabel);
  });

  it("does not append a second 4/4 when the raw value already ends in it", () => {
    const rows = [
      FULL_HEADER,
      ["Acme Co", "", "", "", "Platinum 4/4", "", "", "", "", "Completed", "", ""],
    ];
    const [work] = parsePodcastWorkflowRows(rows, SOURCE_MONTH);
    expect(work?.workLabel).toBe("Platinum 4/4");
  });
});

describe("workLabel — compact partnership blocks (no SEO Package column)", () => {
  it("Name | PODCAST LINK | Status 1 | Assigned Va -> raw package null, Work = Partnership 10/10", () => {
    const rows = [
      ["Name", "PODCAST LINK", "Status 1", "Assigned Va"],
      ["Alvarez Painting LLC", "https://podcast.example/alvarez", "In Progress", "Sam"],
    ];
    const [work] = parsePodcastWorkflowRows(rows, SOURCE_MONTH);

    expect(work?.rawSeoPackage).toBeNull();
    expect(work?.workLabel).toBe("Partnership 10/10");
  });

  it("Name | Logins | PODCAST LINK | Status 1 | Assigned Va -> Work = Partnership 10/10", () => {
    const rows = [
      ["Name", "Logins", "PODCAST LINK", "Status 1", "Assigned Va"],
      ["Spring Valley Roofing", "https://logins.example/spring-valley", "https://podcast.example/spring-valley", "Stuck", "Priya"],
    ];
    const [work] = parsePodcastWorkflowRows(rows, SOURCE_MONTH);

    expect(work?.rawSeoPackage).toBeNull();
    expect(work?.workLabel).toBe("Partnership 10/10");
  });

  it("never invents a fake raw SEO Package for a compact block", () => {
    const rows = [
      ["Name", "PODCAST LINK", "Status 1", "Assigned Va"],
      ["On Point Plumbing", "https://podcast.example/on-point", "Completed", "Kyle"],
    ];
    const [work] = parsePodcastWorkflowRows(rows, SOURCE_MONTH);

    expect(work?.rawSeoPackage).toBeNull();
    expect(work?.workLabel).toBe("Partnership 10/10");
  });

  it("keeps multiple compact blocks in one sheet each independently deriving Partnership 10/10", () => {
    const rows = [
      FULL_HEADER,
      ["Acme Co", "acme@example.com", "", "WF-1001", "Growth", "plumber", "Austin", "", "", "Completed", "", "Jordan"],
      [],
      ["PLATINUM PARTNERS"],
      ["Name", "PODCAST LINK", "Status 1", "Assigned Va"],
      ["Alvarez Painting LLC", "https://podcast.example/alvarez", "In Progress", "Sam"],
      [],
      ["OTHER PARTNERS"],
      ["Name", "Logins", "PODCAST LINK", "Status 1", "Assigned Va"],
      ["Spring Valley Roofing", "https://logins.example/spring-valley", "https://podcast.example/spring-valley", "Stuck", "Priya"],
      ["On Point Plumbing", "https://logins.example/on-point", "https://podcast.example/on-point", "Completed", "Kyle"],
    ];

    const items = parsePodcastWorkflowRows(rows, SOURCE_MONTH);
    expect(items).toHaveLength(4);

    const acme = items.find((entry) => entry.clientName === "Acme Co");
    expect(acme?.workLabel).toBe("Growth 4/4");

    for (const name of ["Alvarez Painting LLC", "Spring Valley Roofing", "On Point Plumbing"]) {
      const partner = items.find((entry) => entry.clientName === name);
      expect(partner?.rawSeoPackage).toBeNull();
      expect(partner?.workLabel).toBe("Partnership 10/10");
    }
  });

  it("Partnership 10/10 is a fixed label the SBP abbreviation never touches", () => {
    const rows = [
      ["Name", "PODCAST LINK", "Status 1", "Assigned Va"],
      ["Alvarez Painting LLC", "https://podcast.example/alvarez", "In Progress", "Sam"],
    ];
    const [work] = parsePodcastWorkflowRows(rows, SOURCE_MONTH);
    expect(work?.workLabel).toBe("Partnership 10/10");
  });
});

describe("abbreviatePackageLabel — \"SEO Success Blueprint\" -> \"SBP\"", () => {
  it.each([
    ["SEO Success Blueprint", "SBP"],
    ["Platinum SEO Success Blueprint", "Platinum SBP"],
    ["SEO Success Blueprint (50 Targeted Keywords)", "SBP (50 Targeted Keywords)"],
    ["Platinum SEO Success Blueprint (100 Targeted Keywords)", "Platinum SBP (100 Targeted Keywords)"],
  ])("%j -> %j", (raw, expected) => {
    expect(abbreviatePackageLabel(raw)).toBe(expected);
  });

  it("leaves an unrelated package name untouched", () => {
    expect(abbreviatePackageLabel("Platinum")).toBe("Platinum");
    expect(abbreviatePackageLabel("Basic SEO")).toBe("Basic SEO");
  });
});

describe("workLabel + rawSeoPackage — SBP examples end to end through the parser", () => {
  it.each([
    ["SEO Success Blueprint", "SEO Success Blueprint", "SBP 4/4"],
    ["Platinum SEO Success Blueprint", "Platinum SEO Success Blueprint", "Platinum SBP 4/4"],
    [
      "SEO Success Blueprint (50 Targeted Keywords)",
      "SEO Success Blueprint (50 Targeted Keywords)",
      "SBP (50 Targeted Keywords) 4/4",
    ],
    [
      "Platinum SEO Success Blueprint (100 Targeted Keywords)",
      "Platinum SEO Success Blueprint (100 Targeted Keywords)",
      "Platinum SBP (100 Targeted Keywords) 4/4",
    ],
  ])("raw %j stays untouched on rawSeoPackage while workLabel becomes %j", (raw, expectedRaw, expectedWorkLabel) => {
    const rows = [
      FULL_HEADER,
      ["Acme Co", "acme@example.com", "", "WF-1001", raw, "plumber", "Austin", "", "", "Completed", "", "Jordan"],
    ];
    const [work] = parsePodcastWorkflowRows(rows, SOURCE_MONTH);

    // The raw Sheet value is never rewritten — only the derived display label is shortened.
    expect(work?.rawSeoPackage).toBe(expectedRaw);
    expect(work?.workLabel).toBe(expectedWorkLabel);
  });
});
