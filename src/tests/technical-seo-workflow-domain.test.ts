import { describe, expect, it } from "vitest";
import { credibleTechnicalSeoAssignee, locateTechnicalSeoLinkColumns, parseTechnicalSeoWorkflowRows } from "../domain/operations/technical-seo-workflow";

const header = ["Name", "SEO Package", "Technical Before", "Status", "Technical After", "Status 1", "Mobile Before", "Status 4", "Mobile after", "Status", "Desktop Before", "Status 2", "Desktop After", "Status 3"];
const parse = (rows: string[][]) => parseTechnicalSeoWorkflowRows(rows, "TECHNICAL SEO SEPTEMBER 2026");

describe("Technical SEO source-owned evidence model", () => {
  it("pairs each evidence field with its adjacent status, independent of numbered status labels", () => {
    const [item] = parse([header, ["Client", "Platinum", "before", "Done", "after", "Cancel", "", "Done", "", "", "", "Done", "", "Done"]]);
    expect(item!.evidence.map((field) => field.rawStatus)).toEqual(["Done", "Cancel", "Done", null, "Done", "Done"]);
    expect(item!.status).toBe("Cancelled");
    expect(item!.phases).toEqual([{ label: "Technical", status: "Cancelled" }, { label: "Mobile", status: "In Progress" }, { label: "Desktop", status: "Completed" }]);
  });
  it("preserves single-cell clients and resets block-specific identity columns", () => {
    const items = parse([["Leader (JOHN)"], header, ["First", "Platinum"], [], ["Partner section"], ["Name", "Technical Before", "Status", "Technical After", "Status 1"], ["Only a client"], ["Second", "", "Done", "", "Done"]]);
    expect(items.map((item) => item.client)).toEqual(["First", "Only a client", "Second"]);
    expect(items[1]!.seoPackage).toBeNull();
    expect(items[1]!.assignedVa).toBeNull();
    expect(items[1]!.sourceSection).toBe("Partner section");
    expect(items[1]!.sourceRow).toBe(7);
  });
  it("requires explicit completion and never turns output links or blanks into completed/failed tasks", () => {
    const items = parse([header,
      ["Links", "", "https://drive.google.com/file/d/before", "", "https://drive.google.com/file/d/after"],
      ["Blank"],
      ["Complete", "", "", "Done", "", "Done", "", "Done", "", "Done", "", "Done", "", "Done"],
    ]);
    expect(items.map((item) => item.status)).toEqual(["In Progress", "Not recorded", "Completed"]);
    expect(items[0]).not.toHaveProperty("progress");
    expect(items[0]).not.toHaveProperty("applicableDeliverables");
  });
  it("preserves unknown operational status, excludes explicit N/A, and applies attention precedence", () => {
    const h = ["Name", "Technical Before", "Status", "Technical After", "Status 1", "Notes"];
    const items = parse([h,
      ["Waiting", "", "Waiting for access"],
      ["NA", "", "Done", "", "N/A"],
      ["Stuck", "", "Cancelled", "", "Paused", "NEED LOGIN CREDENTIALS"],
      ["Paused", "", "Cancelled", "", "Paused"],
    ]);
    expect(items.map((item) => item.status)).toEqual(["Waiting for access", "Completed", "Stuck", "Paused"]);
    expect(items[2]!.notes[0]!.value).toBe("NEED LOGIN CREDENTIALS");
  });
  it("handles real legacy phase statuses and preserves remarks/bottlenecks/actions independently", () => {
    const [item] = parse([["", "Executive Name", "SEO Order#", "Website URL", "Technical Before", "Technical After", "Status", "Remarks", "Bottleneck", "Actions"], ["", "LORENZO", "WF-1", "https://example.com", "before", "after", "Completed", "Passed", "NEED LOGIN CREDENTIALS", "Request access"]]);
    expect(item!.evidence.map((field) => field.rawStatus)).toEqual(["Completed", "Completed"]);
    expect(item!.status).toBe("Stuck");
    expect(item!.notes).toHaveLength(3);
    expect(item!.assignedVa).toBeNull();
  });
  it.each(["Completed", "Cancel", "Pending", "Not Started", "NEED LOGIN CREDENTIALS", "https://example.com", "Technical SEO", "Working", "Team", "N/A"])("rejects non-human assignee %s", (value) => {
    expect(credibleTechnicalSeoAssignee(value)).toBeNull();
  });
  it("uses only credible explicit assignee cells and never leader/owner section text", () => {
    const items = parse([["Leader JOHN"], ["Name", "Assigned VA", "Assigned VA", "Technical Before", "Status"], ["One", "Completed", "Rap", "", "Done"], ["Two", "NEED LOGIN CREDENTIALS", "https://example.com"]]);
    expect(items.map((item) => item.assignedVa)).toEqual(["Rap", null]);
  });
  it("discovers resource columns across all header layouts without reading credentials as plain text", () => {
    expect(locateTechnicalSeoLinkColumns([["Name", "Logins", "Technical Before", "Status", "Technical After", "Status 1", "DAILY OUTPUT"]])).toEqual([0, 1, 2, 4, 6]);
    const [item] = parse([["Name", "Logins", "Technical Before", "Status"], ["Client", "plain login detail", "", "Done"]]);
    expect(JSON.stringify(item)).not.toContain("plain login detail");
  });
  it("surfaces a non-URL Daily output value as a note instead of dropping it, and still links it when it is a URL", () => {
    const h = ["Name", "Technical Before", "Status", "Technical After", "Status 1", "DAILY OUTPUT"];
    const [textItem] = parse([h, ["Client", "", "Done", "", "Done", "Login credentials"]]);
    expect(textItem!.notes).toContainEqual({ label: "Daily output", value: "Login credentials" });
    expect(textItem!.resources.some((resource) => resource.label === "Daily output")).toBe(false);
    const [linkItem] = parse([h, ["Client", "", "Done", "", "Done", "https://example.com/output"]]);
    expect(linkItem!.notes).toHaveLength(0);
    expect(linkItem!.resources).toContainEqual({ label: "Daily output", outputUrl: "https://example.com/output" });
  });
});
