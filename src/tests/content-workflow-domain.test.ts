import { describe, expect, it } from "vitest";
import {
  normalizeContentStatus,
  parseContentWorkflowRows,
} from "../domain/operations/content-workflow";

const HEADER = [
  "Website",
  "Email",
  "logins",
  "Order #",
  "SEO Package",
  "Primary Keyword",
  "City",
  "PROMPT / SOP",
  "4 Blog Content",
  "Status",
];

describe("normalizeContentStatus", () => {
  it("normalizes completed, stuck, cancelled, and in-progress variants", () => {
    expect(normalizeContentStatus("Published")).toBe("completed");
    expect(normalizeContentStatus("BLOCKED")).toBe("stuck");
    expect(normalizeContentStatus("canceled")).toBe("cancelled");
    expect(normalizeContentStatus("In_progress")).toBe("in_progress");
    expect(normalizeContentStatus("Queued")).toBe("in_progress");
  });

  it("keeps blank and unknown workflow states safely actionable", () => {
    expect(normalizeContentStatus("")).toBe("in_progress");
    expect(normalizeContentStatus("Awaiting brief")).toBe("in_progress");
  });
});

describe("parseContentWorkflowRows", () => {
  it("maps the Content schema without using the Podcast record shape", () => {
    const items = parseContentWorkflowRows([
      HEADER,
      [
        "https://acme.example.com",
        "ops@acme.example.com",
        "https://docs.example.com/logins",
        "WF-204",
        "Growth",
        "emergency plumbing",
        "Austin",
        "https://docs.example.com/sop",
        "https://docs.example.com/blogs",
        "Completed",
      ],
    ], "CONTENT AUGUST 2026");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceTab: "CONTENT AUGUST 2026",
      sourceSection: "Content",
      website: "https://acme.example.com",
      email: "ops@acme.example.com",
      loginUrl: "https://docs.example.com/logins",
      orderNumber: "WF-204",
      seoPackage: "Growth",
      primaryKeyword: "emergency plumbing",
      city: "Austin",
      promptSopUrl: "https://docs.example.com/sop",
      blogContent: "https://docs.example.com/blogs",
      normalizedStatus: "completed",
      rawStatus: "Completed",
    });
    expect(items[0]).not.toHaveProperty("podcastUrl");
    expect(items[0]).not.toHaveProperty("assignedVa");
  });

  it("is header-driven when columns are reordered and uses alias spellings", () => {
    const items = parseContentWorkflowRows([
      ["Workflow Status", "Site URL", "Content Output", "Keyword", "Location"],
      ["Needs Attention", "https://reordered.example.com", "Drafts ready", "roof repair", "Denver"],
    ], "August 2026");

    expect(items[0]).toMatchObject({
      website: "https://reordered.example.com",
      blogContent: "Drafts ready",
      primaryKeyword: "roof repair",
      city: "Denver",
      normalizedStatus: "stuck",
    });
  });

  it("tolerates partial rows and drops rows with no website identity", () => {
    const items = parseContentWorkflowRows([
      HEADER,
      ["https://partial.example.com", "", "", "WF-9", "", "", "", "", "", ""],
      ["", "orphan@example.com", "", "WF-10", "Growth", "keyword", "", "", "", "Completed"],
      ["https://short.example.com"],
    ], "CONTENT AUGUST 2026");

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      website: "https://partial.example.com",
      email: null,
      orderNumber: "WF-9",
      normalizedStatus: "in_progress",
    });
    expect(items[1]).toMatchObject({
      website: "https://short.example.com",
      orderNumber: null,
      normalizedStatus: "in_progress",
    });
  });

  it("recognizes multiple titled blocks with their own partial headers", () => {
    const items = parseContentWorkflowRows([
      HEADER,
      ["https://main.example.com", "", "", "", "Core", "", "", "", "", "Completed"],
      [],
      ["Partner content"],
      ["Website", "Status"],
      ["https://partner.example.com", "In Progress"],
    ], "CONTENT AUGUST 2026");

    expect(items).toHaveLength(2);
    expect(items[1]?.sourceSection).toBe("Partner content");
  });
});
