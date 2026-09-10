/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TechnicalSeoWorkflowView } from "../components/operations/technical-seo-workflow-view";
import { parseTechnicalSeoWorkflowRows } from "../domain/operations/technical-seo-workflow";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/todo/departments/technical-seo", useSearchParams: () => new URLSearchParams() }));
afterEach(() => { cleanup(); push.mockClear(); });
const sourceTab = "TECHNICAL SEO SEPTEMBER 2026";
const header = ["Name", "SEO Package", "Technical Before", "Status", "Technical After", "Status 1", "Notes", "Assigned VA"];
const items = parseTechnicalSeoWorkflowRows([header,
  ["https://example.com", "Platinum", "https://drive.google.com/file/d/before", "Done", "https://docs.google.com/document/d/after", "", ""],
  ["Blocked client", "Basic SEO", "", "", "", "", "NEED LOGIN CREDENTIALS"],
  ["Complete client", "Basic SEO", "", "Done", "", "Done"],
], sourceTab);
const props = { state: "ready" as const, items, sourceTab, lastSyncedAt: null };

describe("Technical SEO workspace", () => {
  it("distinguishes unconfigured, failure, empty, and real data", () => {
    const { rerender } = render(<TechnicalSeoWorkflowView {...props} state="unconfigured" items={[]} />);
    expect(screen.getByRole("status", { name: "Technical SEO workflow not connected yet" })).toBeInTheDocument();
    rerender(<TechnicalSeoWorkflowView {...props} state="error" items={[]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("source could not be read");
    expect(screen.queryByText(/No Technical SEO workflow records/)).not.toBeInTheDocument();
    rerender(<TechnicalSeoWorkflowView {...props} items={[]} />);
    expect(screen.getByText("No Technical SEO workflow records were found.")).toBeInTheDocument();
    rerender(<TechnicalSeoWorkflowView {...props} />);
    expect(screen.getByRole("table")).toHaveTextContent("ClientPackageTechnicalStatusResources");
    expect(screen.queryByRole("button", { name: /^Filter by assigned VA:/ })).not.toBeInTheDocument();
  });
  it("searches task/status/note fields and filters real packages and statuses", () => {
    render(<TechnicalSeoWorkflowView {...props} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "credentials" } });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("row", { name: "Open Blocked client" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Filter by status: All Statuses" }));
    fireEvent.click(screen.getByRole("option", { name: /Completed.*1/ }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("row", { name: "Open Complete client" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Filter by status:/ }));
    fireEvent.click(screen.getByRole("option", { name: /All Statuses.*3/ }));
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Filters" })).getByRole("button", { name: "Platinum" }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("row", { name: "Open example.com" })).toBeInTheDocument();
  });
  it("opens the anchored resource menu without opening the inspector, and exposes the same mobile action", () => {
    const { container } = render(<TechnicalSeoWorkflowView {...props} />);
    const row = screen.getByRole("row", { name: "Open example.com" });
    fireEvent.click(within(row).getByRole("button", { name: "2 resources" }));
    const menu = screen.getByRole("dialog", { name: "Available resources" });
    expect(within(menu).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(items[0]!.resources.map((resource) => resource.outputUrl));
    expect(screen.queryByRole("tab", { name: "Technical Work" })).not.toBeInTheDocument();
    fireEvent.keyDown(menu, { key: "Escape" });
    fireEvent.click(within(container.querySelector(".dept-mobile-list") as HTMLElement).getByRole("button", { name: "2 resources" }));
    expect(screen.getByRole("dialog", { name: "Available resources" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Technical Work" })).not.toBeInTheDocument();
  });
  it("shows source statuses and blocker notes in the shared inspector", () => {
    render(<TechnicalSeoWorkflowView {...props} />);
    fireEvent.click(screen.getByRole("row", { name: "Open Blocked client" }));
    fireEvent.click(screen.getByRole("tab", { name: "Technical Work" }));
    expect(screen.getByText("Technical Before")).toBeInTheDocument();
    expect(screen.getByText("NEED LOGIN CREDENTIALS")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    expect(screen.getByText(sourceTab)).toBeInTheDocument();
  });
  it("routes month changes and resets filters/selection when the source tab changes", () => {
    const months = [{ value: "2026-09", label: "September 2026", tabTitle: sourceTab }, { value: "2026-08", label: "August 2026", tabTitle: "TECHNICAL SEO AUGUST 2026" }];
    const { rerender } = render(<TechnicalSeoWorkflowView {...props} monthOptions={months} selectedMonth="2026-09" />);
    fireEvent.click(screen.getByRole("button", { name: /^Month:/ }));
    fireEvent.click(screen.getByRole("option", { name: "August 2026" }));
    expect(push).toHaveBeenCalledWith("/todo/departments/technical-seo?month=2026-08");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "does not exist" } });
    rerender(<TechnicalSeoWorkflowView {...props} sourceTab="TECHNICAL SEO AUGUST 2026" />);
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });
  it("shows credible assignment only when supplied and handles zero/single resources", () => {
    const assigned = parseTechnicalSeoWorkflowRows([header, ["Assigned client", "", "https://drive.google.com/file/d/one", "", "", "", "", "Rap"], ["No links"]], sourceTab);
    render(<TechnicalSeoWorkflowView {...props} items={assigned} />);
    expect(screen.getByRole("columnheader", { name: "Assigned" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Filter by assigned VA:/ })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: "Open Assigned client" });
    fireEvent.click(within(row).getByRole("link", { name: "Open resource" }));
    expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeInTheDocument();
    expect(screen.getByRole("row", { name: "Open No links" })).toHaveTextContent("Not available");
  });
});
