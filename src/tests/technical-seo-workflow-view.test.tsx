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
    expect(screen.getByRole("table")).toHaveTextContent("ClientPackageTechnicalStatusNotesResources");
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
  it("shows the note preview and full source statuses/blocker text in the main table and shared inspector", () => {
    render(<TechnicalSeoWorkflowView {...props} />);
    // The blocker preview is scannable directly in the table, without opening the inspector.
    expect(within(screen.getByRole("row", { name: "Open Blocked client" })).getByText("NEED LOGIN CREDENTIALS")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("row", { name: "Open Blocked client" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Technical Work" }));
    expect(within(dialog).getByText("Technical Before")).toBeInTheDocument();
    // Notes/blockers live in their own tab now, not buried under Technical Work.
    expect(within(dialog).queryByText("NEED LOGIN CREDENTIALS")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Notes / Blockers" }));
    expect(within(dialog).getByText("NEED LOGIN CREDENTIALS")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Source" }));
    expect(within(dialog).getByText(sourceTab)).toBeInTheDocument();
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
  it("contains an anomalously long status value inside its table cell (never escaping into Resources) via real CSS clamping, not string truncation", () => {
    const longStatus = "https://drive.google.com/file/d/1Mb7tPphgVTFHyErCVUSk3xo6qSoPGRSR/view?usp=drivesdk";
    const oddItems = parseTechnicalSeoWorkflowRows([header, ["Odd status client", "Platinum", "", longStatus, "", ""]], sourceTab);
    render(<TechnicalSeoWorkflowView {...props} items={oddItems} />);
    const row = screen.getByRole("row", { name: "Open Odd status client" });
    // The row's own derived status is source-honestly the same long value — never reinterpreted or dropped.
    expect(oddItems[0]!.status).toBe(longStatus);

    // The DOM text is never truncated — jsdom can't render layout, so the actual containment must be
    // real CSS on the label span (a flex item with its own `min-width: 0`), not a hand-truncated string.
    // `.workflow-status`'s default flex `min-width: auto` is exactly what let the URL escape in the bug report.
    const labelSpans = within(row).getAllByText(longStatus);
    expect(labelSpans.length).toBeGreaterThan(0); // Technical + Status columns both derive from this evidence.
    for (const labelSpan of labelSpans) {
      expect(labelSpan.style.minWidth).toBe("0px");
      expect(labelSpan.style.overflow).toBe("hidden");
      expect(labelSpan.style.textOverflow).toBe("ellipsis");
      expect(labelSpan.style.whiteSpace).toBe("nowrap");
      // The pill wrapper (dot + label) is a flex row that fills — but never exceeds — the fixed-width cell.
      const pill = labelSpan.parentElement!;
      expect(pill.style.display).toBe("flex");
      expect(pill.style.minWidth).toBe("0px");
      expect(pill.style.maxWidth).toBe("100%");
      expect(pill.getAttribute("title")).toBe(longStatus);
    }

    fireEvent.click(row);
    const dialog = screen.getByRole("dialog");
    // The panel itself never grows past its own fixed width, in jsdom terms: nothing here can push the
    // dialog's own rendered width out — real containment is asserted via the per-element CSS below, since
    // jsdom has no layout engine to measure actual overflow (that's covered by manual live verification).
    fireEvent.click(within(dialog).getByRole("tab", { name: "Technical Work" }));
    // The inspector shows the same full value, but wrapped (not clamped) so it can never force horizontal
    // overflow on the panel: `overflow-wrap: anywhere` (not `break-word`) is what actually shrinks the
    // element's own intrinsic width, which is what stops `.onpage-deliverable-row`'s `auto` action column
    // from blowing out — plain wrapping alone would still report a huge max-content size to that grid track.
    const evidenceLabel = within(dialog).getAllByText(longStatus).find((el) => el.closest(".onpage-deliverable-action"))!;
    expect(evidenceLabel.style.overflowWrap).toBe("anywhere");
    expect(evidenceLabel.style.wordBreak).toBe("break-word");
    expect(evidenceLabel.style.minWidth).toBe("0px");
    // No ellipsis/title mechanism in the inspector — the full text is directly visible, not hidden behind a tooltip.
    expect(evidenceLabel.parentElement!.getAttribute("title")).toBeNull();

    // The header identity badge (`.dept-inspector-identity`) shows this same long value too, and was the
    // first place this bug actually reproduced live: it blew the 420px panel out to ~545px on its own,
    // even after the evidence row above was already fixed. It needs the identical wrap treatment.
    fireEvent.click(within(dialog).getByRole("tab", { name: "Overview" }));
    const headerLabel = within(dialog.querySelector(".dept-inspector-identity")!).getByText(longStatus);
    expect(headerLabel.style.overflowWrap).toBe("anywhere");
    expect(headerLabel.style.minWidth).toBe("0px");

    // The Overview tab's own "Status" field row (`.dept-inspector-field`, a `justify-content: space-between`
    // flex row) renders this same value a second time via the shared, generic field renderer — this was the
    // actual final source of the panel overflow, since it bypasses the local `Status` component entirely
    // unless the field's own `value` is passed as an already wrap-safe node instead of a bare string.
    const fieldLabel = within(dialog.querySelector(".dept-inspector-fields")!).getByText(longStatus);
    expect(fieldLabel.style.overflowWrap).toBe("anywhere");
    expect(fieldLabel.style.wordBreak).toBe("break-word");
    expect(fieldLabel.style.minWidth).toBe("0px");
  });
  it("does not change the badge markup for ordinary short statuses", () => {
    render(<TechnicalSeoWorkflowView {...props} />);
    for (const label of ["Completed", "In Progress"]) {
      const badge = screen.getAllByText(label)[0]!;
      expect(badge.style.overflow).toBe("hidden");
      expect(badge.textContent).toBe(label);
    }
  });
  it("prioritizes a real blocker note over the phase summary on the mobile detail line, and falls back when there is none", () => {
    const { container } = render(<TechnicalSeoWorkflowView {...props} />);
    const mobileList = container.querySelector(".dept-mobile-list") as HTMLElement;
    const blockedRow = within(mobileList).getByRole("button", { name: /Blocked client/ });
    expect(within(blockedRow).getByText("NEED LOGIN CREDENTIALS")).toBeInTheDocument();
    const cleanRow = within(mobileList).getByRole("button", { name: /example\.com/ });
    expect(within(cleanRow).getByText(/^Technical:/)).toBeInTheDocument();
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
