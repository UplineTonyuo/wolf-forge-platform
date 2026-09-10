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

    expect(screen.getByRole("table")).toHaveTextContent("ClientPackageContentPostingStatusOutputs");
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
    expect(screen.queryByRole("tab", { name: "Workflow" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("row", { name: "Open client.example" }));
    const inspector = screen.getAllByRole("dialog").find((dialog) => within(dialog).queryByRole("tab", { name: "Workflow" }))!;
    fireEvent.click(within(inspector).getByRole("tab", { name: "Workflow" }));
    expect(within(inspector).getByText("GMB Content")).toBeInTheDocument();
    expect(within(inspector).getByText("GMB Posting")).toBeInTheDocument();
    expect(within(inspector).getByText("needs verification")).toBeInTheDocument();
  });
});

function operationItem(): GmbOperationItem {
  return {
    id: "gmb-1",
    sourceTab: "SEPTEMBER 2026",
    sourceSection: "GMB Management",
    client: "https://client.example",
    clientUrl: "https://client.example",
    email: "client@example.com",
    loginUrl: "https://docs.google.com/document/d/login",
    orderNumber: "WF-1",
    seoPackage: "Platinum",
    primaryKeyword: "junk removal",
    city: "Austin",
    promptSopUrl: "https://docs.google.com/document/d/sop",
    onboardingSheetUrl: null,
    notes: "needs verification",
    contentStage: stage("content", "GMB Content", "completed", "https://docs.google.com/document/d/content"),
    postingStage: stage("posting", "GMB Posting", "in_progress", "https://drive.google.com/file/d/posting"),
    normalizedStatus: "in_progress",
  };
}

function stage(key: "content" | "posting", label: "GMB Content" | "GMB Posting", state: GmbStageState, outputUrl: string) {
  return { key, label, sourceLabel: label, state, rawStatus: state, output: outputUrl, outputUrl };
}
