/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WebsiteBuilderWorkflowView } from "../components/operations/website-builder-workflow-view";
import type { WebsiteBuilderProject } from "../domain/operations/website-builder-workflow";

afterEach(cleanup);

describe("WebsiteBuilderWorkflowView", () => {
  it("distinguishes unconfigured and source failure states from a real empty result", () => {
    const { rerender } = render(<WebsiteBuilderWorkflowView state="unconfigured" projects={[]} sourceTab={null} lastSyncedAt={null} />);
    expect(screen.getByRole("status", { name: "Website Builder workflow not connected yet" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    rerender(<WebsiteBuilderWorkflowView state="error" projects={[]} sourceTab={null} lastSyncedAt={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable");

    rerender(<WebsiteBuilderWorkflowView state="ready" projects={[]} sourceTab="WEB BUILD ORDER" lastSyncedAt={null} />);
    expect(screen.getByText("No Website Builder workflow records were found.")).toBeInTheDocument();
  });

  it("hides the Executive column/filter when no project carries credible executive data", () => {
    const project = projectFixture({ executive: null });
    render(<WebsiteBuilderWorkflowView state="ready" projects={[project]} sourceTab={project.sourceTab} lastSyncedAt={null} />);
    expect(screen.getByRole("table")).toHaveTextContent("BusinessOnboardedETADomainStatusBottleneckResources");
    expect(screen.queryByRole("button", { name: /^Filter by executive:/ })).not.toBeInTheDocument();
  });

  it("renders real distinct pipeline statuses, the bottleneck column, resources, and the delivery inspector when executive data exists", () => {
    const blocked = projectFixture({ id: "wb-1", business: "Pointe Roofing Pros", status: { key: "in_progress", label: "In Progress" }, bottleneck: "Pro mover to import website is not working" });
    const waitingForDomain = projectFixture({ id: "wb-2", business: "Elmwood tow truck", status: { key: "waiting_for_domain", label: "Waiting for Domain" }, bottleneck: null, obUrl: null, webContentUrl: null });
    render(<WebsiteBuilderWorkflowView state="ready" projects={[blocked, waitingForDomain]} sourceTab="WEB BUILD ORDER" lastSyncedAt="2026-09-10T00:00:00.000Z" />);

    // "Actions" is gone from the main table — it was a stale/ambiguous source header, not a real action item.
    expect(screen.getByRole("table")).toHaveTextContent("BusinessExecutiveOnboardedETADomainStatusBottleneckResources");
    expect(screen.getByRole("button", { name: /^Filter by executive:/ })).toBeInTheDocument();
    // The legacy horizontal status strip is gone; status filtering lives in the same compact
    // "All Statuses" dropdown every other Operations department uses.
    expect(screen.queryByRole("group", { name: "Filter by status" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filter by status: All Statuses" }));
    const statusOptions = screen.getAllByRole("option");
    // Real pipeline statuses stay distinct — never collapsed into a generic "In Progress".
    expect(statusOptions.map((option) => option.textContent)).toEqual([
      "All Statuses2",
      "Waiting for Domain1",
      "In Progress1",
    ]);
    fireEvent.click(screen.getByRole("option", { name: /In Progress.*1/ }));
    expect(within(screen.getByRole("table")).getByText("Pointe Roofing Pros")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByText("Elmwood tow truck")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(within(screen.getByRole("table")).getByText("Pro mover to import website is not working")).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ projects$/)).not.toBeInTheDocument();

    // Neither fixture has zero links, so "Not available" never renders here.
    expect(screen.queryByText("Not available")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "3 resources" })[0]!);
    const resources = screen.getByRole("dialog", { name: "Available resources" });
    expect(within(resources).getAllByText(/Onboarding Sheet|Web Content|Domain/).map((el) => el.textContent)).toEqual(
      expect.arrayContaining(["Onboarding Sheet", "Web Content", "Domain"]),
    );

    fireEvent.click(screen.getByRole("row", { name: "Open Pointe Roofing Pros" }));
    const inspector = screen.getAllByRole("dialog").find((dialog) => within(dialog).queryByRole("tab", { name: "Delivery" }))!;
    fireEvent.click(within(inspector).getByRole("tab", { name: "Delivery" }));
    expect(within(inspector).getByText("Bottleneck")).toBeInTheDocument();
    expect(within(inspector).getByText("Pro mover to import website is not working")).toBeInTheDocument();
    // The cryptic raw "OB" sheet label reads as "Onboarding Sheet" in the inspector, matching the Resources tab's own naming.
    expect(within(inspector).getByText("Onboarding Sheet")).toBeInTheDocument();
    expect(within(inspector).queryByText("OB")).not.toBeInTheDocument();
  });

  it("matches the shared Operations toolbar shape — Search, Executive, Status, no Package filter — and combines Executive + Status", () => {
    const macky = projectFixture({ id: "wb-1", business: "Pointe Roofing Pros", executive: "Macky", status: { key: "in_progress", label: "In Progress" } });
    const isaiahInProgress = projectFixture({ id: "wb-2", business: "Elmwood tow truck", executive: "ISAIAH", status: { key: "in_progress", label: "In Progress" } });
    const isaiahBacklog = projectFixture({ id: "wb-3", business: "VJ Plumbing", executive: "ISAIAH", status: { key: "backlog", label: "Backlog" } });
    render(<WebsiteBuilderWorkflowView state="ready" projects={[macky, isaiahInProgress, isaiahBacklog]} sourceTab="WEB BUILD ORDER" lastSyncedAt={null} />);

    // No Package/Filters control exists for Website Builder — it never had package data.
    expect(screen.queryByRole("button", { name: "Filters" })).not.toBeInTheDocument();
    expect(screen.queryByText("All Packages")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Filter by executive:/ }));
    fireEvent.click(screen.getByRole("option", { name: "ISAIAH" }));
    fireEvent.click(screen.getByRole("button", { name: "Filter by status: All Statuses" }));
    fireEvent.click(screen.getByRole("option", { name: /^In Progress/ }));

    expect(within(screen.getByRole("table")).getByText("Elmwood tow truck")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByText("Pointe Roofing Pros")).not.toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByText("VJ Plumbing")).not.toBeInTheDocument();
  });

  it("keeps the real Actions source value, verbatim, in the inspector's Delivery tab even though it no longer appears in the main table", () => {
    const project = projectFixture({ id: "wb-3", business: "Kristy Plumbing", actions: "217 Pages" });
    render(<WebsiteBuilderWorkflowView state="ready" projects={[project]} sourceTab="WEB BUILD ORDER" lastSyncedAt={null} />);

    expect(within(screen.getByRole("table")).queryByText("217 Pages")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("row", { name: "Open Kristy Plumbing" }));
    const inspector = screen.getAllByRole("dialog").find((dialog) => within(dialog).queryByRole("tab", { name: "Delivery" }))!;
    fireEvent.click(within(inspector).getByRole("tab", { name: "Delivery" }));
    expect(within(inspector).getByText("Actions")).toBeInTheDocument();
    expect(within(inspector).getByText("217 Pages")).toBeInTheDocument();
  });
});

function projectFixture(overrides: Partial<WebsiteBuilderProject> = {}): WebsiteBuilderProject {
  return {
    id: "wb-1",
    sourceTab: "WEB BUILD ORDER",
    sourceSection: "Macky",
    executive: "Macky",
    orderNumber: "465FBB6C_9",
    business: "Detroit Roofers",
    businessUrl: null,
    dateOnboarded: "7/23/2026",
    ob: "OB document",
    obUrl: "https://docs.google.com/document/d/ob/edit",
    eta: null,
    webContent: "Web content document",
    webContentUrl: "https://drive.google.com/drive/folders/webcontent",
    domain: "https://detroofers.com/",
    domainUrl: "https://detroofers.com/",
    status: { key: "waiting_edits", label: "Waiting Edits" },
    bottleneck: null,
    actions: null,
    ...overrides,
  };
}
