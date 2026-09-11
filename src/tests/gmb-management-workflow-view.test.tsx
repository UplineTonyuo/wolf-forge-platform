/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GmbManagementWorkflowView } from "../components/operations/gmb-management-workflow-view";
import type { GmbOperationItem, GmbStageState } from "../domain/operations/gmb-management-workflow";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/todo/departments/gmb-management",
  useSearchParams: () => new URLSearchParams(),
}));

describe("GmbManagementWorkflowView", () => {
  it("distinguishes unconfigured and source failure states from a real empty result", () => {
    const { rerender } = render(<GmbManagementWorkflowView state="unconfigured" items={[]} sourceTab={null} lastSyncedAt={null} />);
    expect(screen.getByRole("status", { name: "GMB Management workflow not connected yet" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    rerender(<GmbManagementWorkflowView state="error" items={[]} sourceTab={null} lastSyncedAt={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable");

    rerender(<GmbManagementWorkflowView state="ready" items={[]} sourceTab="SEPTEMBER 2026" lastSyncedAt={null} />);
    expect(screen.getByText("No GMB Management workflow records were found.")).toBeInTheDocument();
  });

  it("renders stage states, direct outputs, package filtering, and the workflow inspector", () => {
    const item = operationItem();
    render(<GmbManagementWorkflowView state="ready" items={[item]} sourceTab={item.sourceTab} lastSyncedAt="2026-09-10T00:00:00.000Z" monthOptions={[{ value: "2026-09", label: "September 2026", tabTitle: item.sourceTab }]} selectedMonth="2026-09" />);

    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("ClientPackageContentPostingStatusNotesOutputs");
    expect(within(table).getByTitle("needs verification")).toHaveTextContent("needs verification");
    expect(screen.queryByRole("button", { name: /assigned VA/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Filter by SEO package:/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Month:/ })).toHaveTextContent("September 2026");

    // Package filtering moved behind the "Filters" trigger — it's still present, just not a permanent toolbar select.
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const filtersPanel = screen.getByRole("dialog", { name: "Filters" });
    expect(within(filtersPanel).getByText("Platinum")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getAllByRole("button", { name: "2 outputs" })[0]!);
    const outputs = screen.getByRole("dialog", { name: "Available outputs" });
    expect(within(outputs).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "https://docs.google.com/document/d/content",
      "https://drive.google.com/file/d/posting",
    ]);
    expect(screen.queryByRole("tab", { name: "GMB Work" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("row", { name: "Open client.example" }));
    const inspector = screen.getAllByRole("dialog").find((dialog) => within(dialog).queryByRole("tab", { name: "GMB Work" }))!;
    fireEvent.click(within(inspector).getByRole("tab", { name: "GMB Work" }));
    expect(within(inspector).getByText("GMB Content")).toBeInTheDocument();
    expect(within(inspector).getByText("GMB Posting")).toBeInTheDocument();

    fireEvent.click(within(inspector).getByRole("tab", { name: "Notes / Blockers" }));
    expect(within(inspector).getByText("needs verification")).toBeInTheDocument();
  });

  it("clamps long client and package values, and hides the Notes column and tab when no record has notes", () => {
    const item = operationItem({ notes: null, client: "https://a-very-long-real-production-domain-for-stress-testing.example/wp-admin", seoPackage: "Platinum SEO Success Blueprint (100 Targeted Keywords)" });
    render(<GmbManagementWorkflowView state="ready" items={[item]} sourceTab={item.sourceTab} lastSyncedAt={null} />);
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("ClientPackageContentPostingStatusOutputs");
    expect(within(table).queryByText("Notes")).not.toBeInTheDocument();

    const clampedCells = within(table).getAllByText((_, element) => element?.tagName === "SPAN" && (element as HTMLElement).style.whiteSpace === "nowrap") as HTMLElement[];
    expect(clampedCells.length).toBeGreaterThanOrEqual(2);
    for (const cell of clampedCells) {
      expect(cell.style.overflow).toBe("hidden");
      expect(cell.style.textOverflow).toBe("ellipsis");
    }

    fireEvent.click(screen.getByRole("row", { name: /^Open / }));
    const inspector = screen.getAllByRole("dialog").find((dialog) => within(dialog).queryByRole("tab", { name: "GMB Work" }))!;
    expect(within(inspector).queryByRole("tab", { name: "Notes / Blockers" })).not.toBeInTheDocument();
  });
});

function operationItem(overrides: { notes?: string | null; client?: string; seoPackage?: string } = {}): GmbOperationItem {
  const client = overrides.client ?? "https://client.example";
  return {
    id: "gmb-1",
    sourceTab: "SEPTEMBER 2026",
    sourceSection: "GMB Management",
    client,
    clientUrl: client.match(/https?:\/\/[^\s]+/i)?.[0] ?? null,
    email: "client@example.com",
    loginUrl: "https://docs.google.com/document/d/login",
    orderNumber: "WF-1",
    seoPackage: overrides.seoPackage ?? "Platinum",
    primaryKeyword: "junk removal",
    city: "Austin",
    promptSopUrl: "https://docs.google.com/document/d/sop",
    onboardingSheetUrl: null,
    notes: overrides.notes === undefined ? "needs verification" : overrides.notes,
    contentStage: stage("content", "GMB Content", "completed", "https://docs.google.com/document/d/content"),
    postingStage: stage("posting", "GMB Posting", "in_progress", "https://drive.google.com/file/d/posting"),
    normalizedStatus: "in_progress",
  };
}

function stage(key: "content" | "posting", label: "GMB Content" | "GMB Posting", state: GmbStageState, outputUrl: string) {
  return { key, label, sourceLabel: label, state, rawStatus: state, output: outputUrl, outputUrl };
}
