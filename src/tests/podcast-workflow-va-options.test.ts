import { describe, expect, it } from "vitest";
import {
  locateAssignedVaColumns,
  mergeAssignedVaOptions,
  parsePodcastWorkflowRows,
  type PodcastOperationItem,
} from "../domain/operations/podcast-workflow";

const SOURCE_MONTH = "PODCAST AUGUST 2026";

function item(overrides: Partial<PodcastOperationItem> = {}): PodcastOperationItem {
  return {
    id: "1",
    sourceMonth: SOURCE_MONTH,
    sourceSection: "Podcast SEO",
    clientName: "Acme Co",
    email: null,
    loginUrl: null,
    orderNumber: null,
    rawSeoPackage: null,
    workLabel: null,
    primaryKeyword: null,
    city: null,
    promptSopUrl: null,
    podcastUrl: null,
    normalizedStatus: "in_progress",
    rawStatus: "",
    notes: null,
    assignedVa: null,
    ...overrides,
  };
}

describe("mergeAssignedVaOptions", () => {
  it("includes a validation-only VA that has zero matching work items", () => {
    const options = mergeAssignedVaOptions(["LayLay", "Rap", "Anthony", "Kyle"], [item({ assignedVa: "Rap" })]);
    expect(options).toContain("Anthony");
    expect(options).toContain("Kyle");
  });

  it("includes a VA actually present on a row", () => {
    const options = mergeAssignedVaOptions(["LayLay"], [item({ assignedVa: "Rap" })]);
    expect(options).toContain("Rap");
  });

  it("dedupes case-insensitively, preferring the validation list's casing", () => {
    const options = mergeAssignedVaOptions(["LayLay"], [item({ assignedVa: "laylay" }), item({ assignedVa: "LAYLAY " })]);
    expect(options.filter((option) => option.toLowerCase() === "laylay")).toEqual(["LayLay"]);
  });

  it("still includes an actual Assigned VA value the sheet's validation list doesn't know about", () => {
    const options = mergeAssignedVaOptions(["LayLay", "Rap"], [item({ assignedVa: "Priya" })]);
    expect(options).toContain("Priya");
  });

  it("normalizes internal whitespace and drops blanks", () => {
    const options = mergeAssignedVaOptions(["  Lay  Lay  ", "   ", ""], [item({ assignedVa: null })]);
    expect(options).toEqual(["Lay Lay"]);
  });

  it("sorts the final list alphabetically", () => {
    const options = mergeAssignedVaOptions(["Rap", "Anthony", "Kyle", "LayLay"], []);
    expect(options).toEqual(["Anthony", "Kyle", "LayLay", "Rap"]);
  });

  it("performs no I/O and takes no write scope of any kind — pure data merge only", () => {
    // mergeAssignedVaOptions has no fetch/network parameter at all; this
    // documents the contract so a future edit doesn't quietly add one.
    expect(mergeAssignedVaOptions.length).toBe(2);
  });
});

describe("locateAssignedVaColumns", () => {
  it("finds the Assigned VA column position for every recognized block header, main and compact alike", () => {
    const rows = [
      ["Name", "Email", "Logins", "Order #", "SEO Package", "Primary Keyword", "City", "PROMPT/SOP", "PODCAST LINK", "Status 1", "Notes", "Assigned Va"],
      ["Acme Co", "acme@example.com", "", "", "", "", "", "", "", "Completed", "", "Jordan"],
      [],
      ["Name", "PODCAST LINK", "Status 1", "Assigned Va"],
      ["Ridgeline Plumbing", "https://podcast.example/ridgeline", "In Progress", "Sam"],
    ];

    expect(locateAssignedVaColumns(rows)).toEqual([3, 11]);
  });

  it("returns an empty list when no header names an Assigned VA column", () => {
    const rows = [["Name", "Status 1"], ["Solo Client", "In Progress"]];
    expect(locateAssignedVaColumns(rows)).toEqual([]);
  });
});

describe("mergeAssignedVaOptions with real parsed rows", () => {
  it("surfaces the full sheet dropdown even though only some names appear in PODCAST AUGUST 2026 rows", () => {
    const rows = [
      ["Name", "Email", "Logins", "Order #", "SEO Package", "Primary Keyword", "City", "PROMPT/SOP", "PODCAST LINK", "Status 1", "Notes", "Assigned Va"],
      ["Acme Co", "acme@example.com", "", "WF-1001", "Growth", "plumber", "Austin", "", "", "Completed", "", "Rap"],
      ["Blair LLC", "blair@example.com", "", "WF-1002", "Starter", "hvac", "Dallas", "", "", "Stuck", "", "LayLay"],
    ];
    const items = parsePodcastWorkflowRows(rows, SOURCE_MONTH);

    const options = mergeAssignedVaOptions(["LayLay", "Rap", "Anthony", "Kyle"], items);

    expect(options).toEqual(["Anthony", "Kyle", "LayLay", "Rap"]);
  });
});
