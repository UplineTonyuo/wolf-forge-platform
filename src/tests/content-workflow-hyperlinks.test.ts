import { describe, expect, it } from "vitest";
import { applyCellHyperlinks } from "../domain/operations/podcast-workflow";
import {
  locateContentUrlColumns,
  parseContentWorkflowRows,
} from "../domain/operations/content-workflow";

/**
 * Root cause: `GoogleSheetsContentWorkflowSource.fetchLatestContentTab()`
 * called only `readTabValues` (`values.get`, plain display text) and never
 * `OperationsGoogleSheetsReader.readCellHyperlinks()`. A raw pasted URL in
 * BLOG/CONTENT stayed clickable because the displayed text *is* the URL, but
 * a Google Docs/Drive smart chip in that same column renders only its
 * visible title through `values.get` — the real destination lives in
 * `chipRuns[].chip.richLinkProperties.uri`, which was never read for
 * Content — so the row fell back to the unclickable "Recorded" state.
 *
 * `locateContentUrlColumns` + the shared `applyCellHyperlinks` (already
 * proven by the Podcast suite) are the fix, mirroring
 * `podcast-workflow-hyperlinks.test.ts` exactly: resolve the real link
 * server-side, before parsing, so `parseContentWorkflowRows` and the view
 * layer keep working with one plain string per cell.
 */

const PRIMARY_HEADER = [
  "Website", "Email", "logins", "Order #", "SEO Package",
  "Primary Keyword", "City", "PROMPT / SOP", "4 Blog Content", "Status",
];
const SOURCE_TAB = "CONTENT AUGUST 2026";

describe("locateContentUrlColumns", () => {
  it("finds every URL-bearing column (logins, Prompt/SOP, 4 Blog Content) by header, not by position", () => {
    expect(locateContentUrlColumns([PRIMARY_HEADER])).toEqual([2, 7, 8]);
  });

  it("returns nothing for a block with no URL-bearing header at all", () => {
    expect(locateContentUrlColumns([["Website", "Status"]])).toEqual([]);
  });

  it("unions columns across multiple blocks with different local schemas", () => {
    const rows = [
      ["Website", "4 Blog Content", "Status"],
      ["acme.example.com", "https://a", "Completed"],
      ["Small Partner Block"],
      ["Website", "logins", "Status"],
      ["beta.example.com", "https://login", "Stuck"],
    ];
    expect(locateContentUrlColumns(rows)).toEqual([1]);
  });
});

describe("applyCellHyperlinks + parseContentWorkflowRows integration", () => {
  it("raw literal URL in BLOG/CONTENT keeps working unchanged (no discovered hyperlink at all)", () => {
    const rows = [
      PRIMARY_HEADER,
      [
        "dfwairductcleaning.com", "", "", "", "", "", "", "",
        "https://docs.google.com/document/d/raw-literal-url/edit", "Completed",
      ],
    ];

    const items = parseContentWorkflowRows(applyCellHyperlinks(rows, new Map()), SOURCE_TAB);

    expect(items[0]?.blogContent).toBe("https://docs.google.com/document/d/raw-literal-url/edit");
  });

  it("recovers a normal rich-text/HYPERLINK() cell's real target from a friendly label", () => {
    const rows = [
      PRIMARY_HEADER,
      ["calabresehardwood.com", "", "", "", "", "", "", "", "View Output", "Completed"],
    ];
    const hyperlinks = new Map([["1,8", "https://docs.google.com/document/d/normal-hyperlink/edit"]]);

    const items = parseContentWorkflowRows(applyCellHyperlinks(rows, hyperlinks), SOURCE_TAB);

    expect(items[0]?.blogContent).toBe("https://docs.google.com/document/d/normal-hyperlink/edit");
  });

  it("recovers a Google Docs smart chip's underlying URI from its visible chip title", () => {
    const rows = [
      PRIMARY_HEADER,
      ["erik4.sg-host.com", "", "", "", "", "", "", "", "Erik4 Blog Content", "Completed"],
    ];
    const hyperlinks = new Map([["1,8", "https://docs.google.com/document/d/docs-smart-chip/edit"]]);

    const items = parseContentWorkflowRows(applyCellHyperlinks(rows, hyperlinks), SOURCE_TAB);

    expect(items[0]?.blogContent).toBe("https://docs.google.com/document/d/docs-smart-chip/edit");
  });

  it("recovers a Google Drive file smart chip's underlying URI from its visible chip title", () => {
    const rows = [
      PRIMARY_HEADER,
      ["earthstrongjunkremoval.com", "", "", "", "", "", "", "", "Earthstrong Content Folder", "Completed"],
    ];
    const hyperlinks = new Map([["1,8", "https://drive.google.com/drive/folders/drive-smart-chip"]]);

    const items = parseContentWorkflowRows(applyCellHyperlinks(rows, hyperlinks), SOURCE_TAB);

    expect(items[0]?.blogContent).toBe("https://drive.google.com/drive/folders/drive-smart-chip");
  });

  it("never fabricates a link from a visible chip title when no underlying URI was discovered", () => {
    const rows = [
      PRIMARY_HEADER,
      ["mobilebatteryman.com", "", "", "", "", "", "", "", "Mobile Battery Man Blog Content", "Completed"],
    ];

    const items = parseContentWorkflowRows(applyCellHyperlinks(rows, new Map()), SOURCE_TAB);

    expect(items[0]?.blogContent).toBe("Mobile Battery Man Blog Content");
  });

  it("also recovers Login and Prompt/SOP smart chips, not only BLOG/CONTENT", () => {
    const rows = [
      PRIMARY_HEADER,
      [
        "junkremovalincolorado.com", "", "Login Doc", "", "", "", "", "SOP Doc",
        "", "Completed",
      ],
    ];
    const hyperlinks = new Map([
      ["1,2", "https://docs.google.com/document/d/login-chip/edit"],
      ["1,7", "https://docs.google.com/document/d/sop-chip/edit"],
    ]);

    const items = parseContentWorkflowRows(applyCellHyperlinks(rows, hyperlinks), SOURCE_TAB);

    expect(items[0]?.loginUrl).toBe("https://docs.google.com/document/d/login-chip/edit");
    expect(items[0]?.promptSopUrl).toBe("https://docs.google.com/document/d/sop-chip/edit");
  });
});
