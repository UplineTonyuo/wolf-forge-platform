import { describe, expect, it } from "vitest";
import {
  locateWebsiteBuilderLinkColumns,
  normalizeWebsiteBuilderStatus,
  parseWebsiteBuilderWorkflowRows,
} from "../domain/operations/website-builder-workflow";

describe("Website Builder workflow domain", () => {
  it("parses a flat delivery queue, forward-filling executive across a leader-marker section and skipping template/marker rows", () => {
    const rows = [
      ["", "Executive Name", "SEO Order#", "Business name", "Date Onboarded", "OB ", "ETA", "WEB Content", "Domain", "Status", "Bottleneck", "Actions"],
      ["", "Macky EOD - https://docs.example/leader"],
      ["", "Macky", "465FBB6C_9", "Detroit Roofers", "7/23/2026", "https://docs.example/ob", "", "https://docs.example/webcontent", "https://detroofers.com/", "Waiting Edits"],
      ["", "", "", "Pointe Roofing Pros", "7/23/2026", "", "", "https://docs.example/webcontent2", "https://pointeroofingpros.net/", "In Progress", "Pro mover to import website is not working", "Will put it in bottom priority for now"],
      [],
      ["", "", "31B10728", "CES", "", "elianalyons12@gmail.com", "", "https://docs.example/webcontent3", "commercialenergysource.com", "Waiting for Domain"],
    ];

    const projects = parseWebsiteBuilderWorkflowRows(rows, "WEB BUILD ORDER");
    expect(projects).toHaveLength(3);
    expect(projects[0]).toMatchObject({
      executive: "Macky",
      business: "Detroit Roofers",
      businessUrl: null,
      obUrl: "https://docs.example/ob",
      domainUrl: "https://detroofers.com/",
      status: { key: "waiting_edits", label: "Waiting Edits" },
    });
    // Forward-filled from the prior row's explicit "Macky" — the leader marker text itself is never used as a value.
    expect(projects[1]).toMatchObject({
      executive: "Macky",
      business: "Pointe Roofing Pros",
      status: { key: "in_progress", label: "In Progress" },
      bottleneck: "Pro mover to import website is not working",
      actions: "Will put it in bottom priority for now",
    });
    // A stray non-URL value in the OB column (a pasted email) must never be surfaced as a link.
    expect(projects[2]).toMatchObject({
      executive: "Macky",
      obUrl: null,
      status: { key: "waiting_for_domain", label: "Waiting for Domain" },
      // A bare domain with no scheme still becomes a real, honest link.
      domainUrl: "https://commercialenergysource.com",
    });
  });

  it("preserves distinct real pipeline statuses instead of collapsing them into a generic state, and normalizes a known typo", () => {
    const header = ["", "Executive Name", "SEO Order#", "Business name", "Date Onboarded", "OB ", "ETA", "WEB Content", "Domain", "Status", "Bottleneck", "Actions"];
    const rows = [
      header,
      ["", "", "1", "Backlog Co", "", "", "", "", "", "Backog"],
      ["", "", "2", "License Co", "", "", "", "", "", "Waiting for License"],
      ["", "", "3", "No Status Co", "", "", "", "", "", ""],
      ["", "", "4", "Novel Status Co", "", "", "", "", "", "Client Review"],
    ];
    const statuses = parseWebsiteBuilderWorkflowRows(rows, "WEB BUILD ORDER").map((project) => project.status);
    expect(statuses).toEqual([
      { key: "backlog", label: "Backlog" },
      { key: "waiting_for_license", label: "Waiting for License" },
      { key: "not_started", label: "Not Started" },
      { key: "other", label: "Client Review" },
    ]);
  });

  it("normalizeWebsiteBuilderStatus treats a blank value as Not Started and an unrecognized value as its own real state", () => {
    expect(normalizeWebsiteBuilderStatus(null)).toEqual({ key: "not_started", label: "Not Started" });
    expect(normalizeWebsiteBuilderStatus("")).toEqual({ key: "not_started", label: "Not Started" });
    expect(normalizeWebsiteBuilderStatus("Completed")).toEqual({ key: "completed", label: "Completed" });
    expect(normalizeWebsiteBuilderStatus("Some New Stage")).toEqual({ key: "other", label: "Some New Stage" });
  });

  it("locates the real OB/Web Content/Domain link columns", () => {
    const rows = [
      ["", "Executive Name", "SEO Order#", "Business name", "Date Onboarded", "OB ", "ETA", "WEB Content", "Domain", "Status", "Bottleneck", "Actions"],
      [],
      ["", "", "1", "Business", "", "https://docs.example/ob", "", "https://docs.example/wc", "https://example.com", "Completed"],
    ];
    expect(locateWebsiteBuilderLinkColumns(rows)).toEqual([5, 7, 8]);
  });
});
