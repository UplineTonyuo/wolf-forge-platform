import { describe, expect, it } from "vitest";
import {
  applyCellHyperlinks,
  locateUrlColumns,
  parsePodcastWorkflowRows,
} from "../domain/operations/podcast-workflow";

/**
 * Root cause traced for the "View Output" inconsistency: Google Sheets'
 * `values.get` (what `readTabValues` calls) returns only a cell's rendered
 * display text. A row whose author entered a bare URL renders that URL as
 * the cell text and stays clickable through the existing `toSafeHttpUrl`
 * check in `DepartmentResourceLink`; a row whose author instead inserted a
 * rich-text link or an `=HYPERLINK(url, "View Output")` formula renders only
 * the friendly label ("View Output") as the cell text — the real URL exists
 * only in the cell's `hyperlink` metadata, which `values.get` never returns —
 * so that label fails the same URL check and silently falls back to
 * unclickable plain text. Same column, same visual label, inconsistent
 * behavior purely by how each row happened to be authored.
 *
 * `locateUrlColumns` + `applyCellHyperlinks` are the fix: resolve the real
 * link server-side, before parsing, so the parser and every UI component
 * downstream keep working with one plain string per cell and never need to
 * know two representations existed.
 */

const PRIMARY_HEADER = [
  "Name", "Email", "Logins", "Order #", "SEO Package",
  "Primary Keyword", "City", "PROMPT / SOP", "PODCAST LINK", "Status 1", "Notes", "Assigned Va",
];
const SOURCE_MONTH = "PODCAST AUGUST 2026";

describe("locateUrlColumns", () => {
  it("finds every URL-bearing column (Logins, Prompt/SOP, Podcast Link) by header, not by position", () => {
    expect(locateUrlColumns([PRIMARY_HEADER])).toEqual([2, 7, 8]);
  });

  it("returns nothing for a block with no URL-bearing header at all", () => {
    expect(locateUrlColumns([["Name", "Status 1"]])).toEqual([]);
  });

  it("unions columns across multiple blocks with different local schemas", () => {
    const rows = [
      ["Name", "PODCAST LINK", "Status 1"],
      ["Acme", "https://a", "Completed"],
      ["Small Partner Block"],
      ["Name", "Logins", "Status 1"],
      ["Beta", "https://login", "Stuck"],
    ];
    expect(locateUrlColumns(rows)).toEqual([1]);
  });
});

describe("applyCellHyperlinks", () => {
  it("overrides only cells present in the map, leaving every other cell untouched", () => {
    const rows = [
      ["Name", "PODCAST LINK", "Status 1"],
      ["Acme", "View Output", "Completed"],
      ["Beta", "https://already-a-url.example/beta", "Stuck"],
    ];
    const hyperlinks = new Map([["1,1", "https://real-link.example/acme"]]);

    const result = applyCellHyperlinks(rows, hyperlinks);

    expect(result[1]?.[1]).toBe("https://real-link.example/acme");
    expect(result[2]?.[1]).toBe("https://already-a-url.example/beta");
    expect(result[0]).toEqual(rows[0]);
  });

  it("prefers the discovered hyperlink even when the displayed text already looks like a URL", () => {
    const rows = [["https://stale-displayed-url.example"]];
    const hyperlinks = new Map([["0,0", "https://true-target.example"]]);

    expect(applyCellHyperlinks(rows, hyperlinks)[0]?.[0]).toBe("https://true-target.example");
  });

  it("returns a new grid, not the same reference, even with an empty hyperlink map", () => {
    const rows = [["a", "b"]];
    const result = applyCellHyperlinks(rows, new Map());
    expect(result).toEqual(rows);
    expect(result).not.toBe(rows);
  });

  it("ignores a hyperlink entry outside the grid's actual bounds rather than growing rows", () => {
    const rows = [["a"]];
    const result = applyCellHyperlinks(rows, new Map([["5,5", "https://out-of-bounds.example"]]));
    expect(result).toEqual([["a"]]);
  });
});

describe("applyCellHyperlinks + parsePodcastWorkflowRows integration", () => {
  it("recovers the real Podcast Link URL for a row whose cell only shows a friendly label", () => {
    const rows = [
      PRIMARY_HEADER,
      ["Acme Co", "", "", "", "", "", "", "", "View Output", "Completed", "", ""],
    ];
    const hyperlinks = new Map([["1,8", "https://podcast.example/acme-episode"]]);

    const items = parsePodcastWorkflowRows(applyCellHyperlinks(rows, hyperlinks), SOURCE_MONTH);

    expect(items[0]?.podcastUrl).toBe("https://podcast.example/acme-episode");
  });

  it("a row with no discovered hyperlink at all keeps its plain display text unchanged (existing behavior, not a regression)", () => {
    const rows = [
      PRIMARY_HEADER,
      ["Beta LLC", "", "", "", "", "", "", "", "View Output", "Completed", "", ""],
    ];

    const items = parsePodcastWorkflowRows(applyCellHyperlinks(rows, new Map()), SOURCE_MONTH);

    expect(items[0]?.podcastUrl).toBe("View Output");
  });
});
