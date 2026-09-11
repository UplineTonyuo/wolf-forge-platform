import { describe, expect, it } from "vitest";
import { locateOffPageSeoLinkColumns, parseOffPageSeoWorkflowRows } from "../domain/operations/off-page-seo-workflow";

const MAIN_HEADER = ["Name", "Email", "Logins", "Order #", "SEO Package", "Primary Keyword", "City", "4 Press Releases", "Status", "One-time setup of 100 Directory Listings", "Status", "One-time setup of 100 Citations", "Status", "Cloudstack", "Status", "Advance Gstack", "Status", "Infinity ID Loop", "Status"];
const parse = (rows: string[][]) => parseOffPageSeoWorkflowRows(rows, "OFF PAGE SEO SEPTEMBER 2026");

describe("Off-page SEO source-owned deliverable model", () => {
  it("pairs each deliverable with its adjacent status and computes block-scoped progress", () => {
    const [item] = parse([MAIN_HEADER, ["Client", "a@b.com", "https://drive.google.com/x", "ORD1", "Platinum", "Keyword", "City", "", "Done", "", "Done", "", "Stuck", "", "Done", "", "Done", "", "Done"]]);
    expect(item!.deliverables.map((d) => d.state)).toEqual(["completed", "completed", "stuck", "completed", "completed", "completed"]);
    expect(item!.completedDeliverables).toBe(5);
    expect(item!.applicableDeliverables).toBe(6);
    expect(item!.normalizedStatus).toBe("stuck");
  });

  it("gives a reduced Local SEO block its own smaller denominator, not the main block's", () => {
    const reduced = ["Name", "Logins", "100 Citation", "Status", "100 Directories", "Status "];
    const items = parse([MAIN_HEADER, ["A", "", "", "", "", "", "", "", "Done", "", "Done", "", "Done", "", "Done", "", "Done", "", "Done"], ["Local Client"], reduced, ["Reduced Client", "", "https://docs.google.com/x", "Done", "", "Stuck"]]);
    const reducedItem = items.find((i) => i.client === "Reduced Client")!;
    expect(reducedItem.applicableDeliverables).toBe(2);
    expect(reducedItem.completedDeliverables).toBe(1);
    expect(reducedItem.normalizedStatus).toBe("stuck");
  });

  it("treats a bare 'NO' in a deliverable's output as ambiguous — preserved for display, never counted as applicable/inapplicable or as any status", () => {
    const reduced = ["Name", "100 Citation", "Status", "100 Directories", "Status "];
    // Real verified case: "NO" pairs with an explicit "Done on <Month>" status elsewhere in the same workbook, so it must never be read as "not applicable".
    const [item] = parse([reduced, ["Client", "NO", "", "NO", ""]]);
    expect(item!.deliverables.map((d) => d.state)).toEqual(["not_started", "not_started"]);
    expect(item!.applicableDeliverables).toBe(2);
    expect(item!.deliverables[0]!.output).toBe("NO");
    expect(item!.deliverables[0]!.outputUrl).toBeNull();
  });

  it("normalizes 'Done on <Month>' to completed while preserving the exact raw wording", () => {
    const [item] = parse([MAIN_HEADER, ["Client", "", "", "", "", "", "", "NO", "Done on  JULY", "NO", "Done on  JULY", "", "", "", "", "", "", "", ""]]);
    expect(item!.deliverables[0]!.state).toBe("completed");
    expect(item!.deliverables[0]!.rawStatus).toBe("Done on  JULY");
    expect(item!.deliverables[1]!.state).toBe("completed");
  });

  it("reads a status word placed in the output cell as the real status when the status cell is blank (a verified real pattern), instead of treating it as a note", () => {
    const [item] = parse([MAIN_HEADER, ["Client", "", "", "", "", "", "", "", "Done", "", "Done", "", "Done", "PAUSED", "", "PAUSED", "", "PAUSED", ""]]);
    expect(item!.deliverables[3]!.state).toBe("paused");
    expect(item!.deliverables[3]!.output).toBeNull();
    expect(item!.normalizedStatus).toBe("paused");
  });

  it("does not let one cancelled deliverable produce a fabricated non-cancelled read when the whole client row is explicitly cancelled", () => {
    const [item] = parse([MAIN_HEADER, ["Client", "", "", "", "", "", "", "", "Cancelled", "", "Cancelled", "", "Cancelled", "", "Cancelled", "", "Cancelled", "", "Cancelled"]]);
    expect(item!.normalizedStatus).toBe("cancelled");
    expect(item!.attention).toBe("4 Press Releases cancelled");
  });

  it("surfaces the offending deliverable's own raw blocker note as the attention signal instead of inventing text", () => {
    const [item] = parse([MAIN_HEADER, ["Client", "", "", "", "", "", "", "need log.ins", "Stuck", "", "Done", "", "Done", "", "Done", "", "Done", "", "Done"]]);
    expect(item!.normalizedStatus).toBe("stuck");
    expect(item!.attention).toBe("4 Press Releases: need log.ins");
  });

  it("has no attention signal for a healthy client", () => {
    const [item] = parse([MAIN_HEADER, ["Client", "", "", "", "", "", "", "", "Done", "", "Done", "", "Done", "", "Done", "", "Done", "", "Done"]]);
    expect(item!.normalizedStatus).toBe("completed");
    expect(item!.attention).toBeNull();
  });

  it("resolves the alternate Website/Login-OB/Keyword identity header used by one real block", () => {
    const altHeader = ["Website", "Email", "Login/OB", "Order #", "Keyword", "City", "SEO Package", "4 Press Releases", "Status", "One-time setup of 100 Directory Listings", "Status", "One-time setup of 100 Citations", "Status", "Cloudstack", "Status", "Advance Gstack", "Status", "Infinity ID Loop", "Status"];
    const [item] = parse([altHeader, ["https://example.com/", "a@b.com", "https://drive.google.com/x", "ORD2", "widgets", "City", "Basic SEO", "", "Done", "", "Done", "", "Done", "", "Done", "", "Done", "", "Done"]]);
    expect(item!.client).toBe("https://example.com/");
    expect(item!.primaryKeyword).toBe("widgets");
    expect(item!.loginUrl).toBe("https://drive.google.com/x");
  });

  it("canonicalizes a month-suffixed deliverable label to the same key as its unsuffixed form", () => {
    const suffixed = ["Name", "4 Press Releases June", "Status"];
    const [item] = parse([suffixed, ["Client", "", "Done"]]);
    expect(item!.deliverables[0]!.key).toBe("press-release");
    expect(item!.deliverables[0]!.label).toBe("4 Press Releases");
  });

  it("resets block-specific identity and applicability when entering a new block, and does not treat a section title as a client", () => {
    const reduced = ["Name", "100 Citation", "Status", "100 Directories", "Status "];
    const items = parse([
      MAIN_HEADER, ["First", "a@b.com", "", "ORD1", "Platinum", "kw", "City", "", "Done", "", "Done", "", "Done", "", "Done", "", "Done", "", "Done"],
      [], ["Some Owner - LOCAL SEO https://docs.google.com/x"], reduced, ["Second", "", "Done", "", "Done"],
    ]);
    expect(items.map((i) => i.client)).toEqual(["First", "Second"]);
    expect(items[1]!.seoPackage).toBeNull();
    expect(items[1]!.applicableDeliverables).toBe(2);
    expect(items[1]!.sourceSection).toBe("Some Owner - LOCAL SEO https://docs.google.com/x");
  });

  it("discovers deliverable and identity link columns without exposing the Logins column as plain text anywhere", () => {
    expect(locateOffPageSeoLinkColumns([MAIN_HEADER])).toEqual([0, 2, 7, 9, 11, 13, 15, 17]);
    const [item] = parse([["Name", "Logins", "Cloudstack", "Status"], ["Client", "plain login detail", "", "Done"]]);
    expect(JSON.stringify(item)).not.toContain("plain login detail");
  });
});
