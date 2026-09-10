/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PodcastOperationItem } from "../domain/operations/podcast-workflow";
import { PodcastSeoWorkflowView } from "../components/operations/podcast-seo-workflow-view";

afterEach(cleanup);

function item(overrides: Partial<PodcastOperationItem> = {}): PodcastOperationItem {
  return {
    id: "PODCAST AUGUST 2026::Podcast SEO::1",
    sourceMonth: "PODCAST AUGUST 2026",
    sourceSection: "Podcast SEO",
    clientName: "https://seeitgonejunkremoval.com/wp-admin",
    email: "acme@example.com",
    loginUrl: "https://logins.example/acme",
    orderNumber: "WF-1001",
    rawSeoPackage: "Growth",
    workLabel: "Growth 4/4",
    primaryKeyword: "plumber near me",
    city: "Austin",
    promptSopUrl: "https://sop.example/acme",
    podcastUrl: "https://podcast.example/acme",
    normalizedStatus: "in_progress",
    rawStatus: "In Progress",
    notes: null,
    assignedVa: "Jordan",
    ...overrides,
  };
}

const ITEMS: PodcastOperationItem[] = [
  item({ id: "1", clientName: "https://seeitgonejunkremoval.com/wp-admin", normalizedStatus: "in_progress", assignedVa: "Jordan" }),
  item({
    id: "2",
    clientName: "https://www.blairllc.com/",
    normalizedStatus: "stuck",
    assignedVa: "Sam",
    rawSeoPackage: "Starter",
    workLabel: "Starter 4/4",
    primaryKeyword: "hvac repair",
    city: "Dallas",
    notes: "Waiting on client audio",
  }),
  item({
    id: "3",
    clientName: "https://cedargroup.example.com",
    normalizedStatus: "completed",
    assignedVa: "Jordan",
    email: null,
    loginUrl: null,
    orderNumber: null,
    promptSopUrl: null,
    podcastUrl: null,
  }),
];

/** Matches the VAs actually assigned across `ITEMS` — passed as the (server-merged) full option list every render needs now. */
const VA_OPTIONS = ["Jordan", "Sam"];

function table(): HTMLElement {
  return screen.getByRole("table");
}

function openRow(name: RegExp | string) {
  const row = screen.getByRole("row", { name });
  fireEvent.click(row);
}

/** The toolbar's VA/Status filters are an AnimatedSelect trigger + listbox, not a native <select>. */
function chooseToolbarFilter(triggerLabel: string, optionLabel: string) {
  const trigger = screen.getByRole("button", { name: new RegExp(`^${triggerLabel}:`) });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

/** Package filtering lives behind the shared "Filters" popover, a single-level option list rather than a listbox. */
function choosePackageFilter(optionLabel: string) {
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Filters" })).getByRole("button", { name: optionLabel }));
}

function openInspectorTab(label: string) {
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("tab", { name: label }));
}

describe("PodcastSeoWorkflowView — header and read-only", () => {
  it("shows only the title in the main header — no redundant count (the status nav's own \"All N\" already carries it) and no source/read-only clutter", () => {
    render(
      <PodcastSeoWorkflowView
        items={ITEMS}
        sourceMonth="PODCAST AUGUST 2026"
        lastSyncedAt={new Date().toISOString()}
        vaOptions={VA_OPTIONS}
      />,
    );

    expect(screen.getByText("Podcast SEO")).toBeInTheDocument();
    expect(screen.queryByText(/workflows/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter by status: All Statuses" })).toBeInTheDocument();
    // Source/read-only/last-synced now live only in the inspector's Source tab.
    expect(screen.queryByText(/Read only/)).not.toBeInTheDocument();
    expect(screen.queryByText("PODCAST AUGUST 2026")).not.toBeInTheDocument();
  });

  it("shows the unavailable state and no table when items is null", () => {
    render(<PodcastSeoWorkflowView items={null} sourceMonth={null} lastSyncedAt={null} vaOptions={[]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Podcast source unavailable.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("PodcastSeoWorkflowView — clean client domain presentation", () => {
  it("shows a bare domain in the table while the full URL remains the inspector's link target", () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);

    expect(within(table()).getByText("seeitgonejunkremoval.com")).toBeInTheDocument();
    expect(within(table()).queryByText(/https:\/\//)).not.toBeInTheDocument();
    expect(within(table()).queryByText(/wp-admin/)).not.toBeInTheDocument();

    openRow(/seeitgonejunkremoval\.com/);
    const inspector = screen.getByRole("dialog");
    expect(within(inspector).getByText("seeitgonejunkremoval.com")).toBeInTheDocument();
    const openWebsite = within(inspector).getByRole("link", { name: /Open website/ });
    expect(openWebsite).toHaveAttribute("href", "https://seeitgonejunkremoval.com/wp-admin");
  });
});

describe("PodcastSeoWorkflowView — status counts and filtering", () => {
  it("shows a count per status in the status navigation", () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);

    fireEvent.click(screen.getByRole("button", { name: "Filter by status: All Statuses" }));
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "All Statuses3",
      "In Progress1",
      "Stuck1",
      "Completed1",
      "Cancelled0",
    ]);
  });

  it("filters the table by status", () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);

    fireEvent.click(screen.getByRole("button", { name: "Filter by status: All Statuses" }));
    fireEvent.click(screen.getByRole("option", { name: /Stuck.*1/ }));
    expect(within(table()).getByText("blairllc.com")).toBeInTheDocument();
    expect(within(table()).queryByText("seeitgonejunkremoval.com")).not.toBeInTheDocument();
  });

  it("filters by search across client, keyword, city, and order number", () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);

    fireEvent.change(screen.getByLabelText("Search Podcast SEO work"), { target: { value: "hvac" } });
    expect(within(table()).getByText("blairllc.com")).toBeInTheDocument();
    expect(within(table()).queryByText("seeitgonejunkremoval.com")).not.toBeInTheDocument();
  });

  it("filters by assigned VA and by derived Work label", () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);

    chooseToolbarFilter("Filter by assigned VA", "Sam");
    expect(within(table()).getByText("blairllc.com")).toBeInTheDocument();
    expect(within(table()).queryByText("seeitgonejunkremoval.com")).not.toBeInTheDocument();

    chooseToolbarFilter("Filter by assigned VA", "All VAs");
    choosePackageFilter("Starter 4/4");
    expect(within(table()).getByText("blairllc.com")).toBeInTheDocument();
    expect(within(table()).queryByText("seeitgonejunkremoval.com")).not.toBeInTheDocument();
  });

  it("shows the sheet's full Assigned VA option list even when a VA has zero current rows", () => {
    render(
      <PodcastSeoWorkflowView
        items={ITEMS}
        sourceMonth="PODCAST AUGUST 2026"
        lastSyncedAt={null}
        vaOptions={["Anthony", "Jordan", "Kyle", "Sam"]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Filter by assigned VA:/ }));
    // "Anthony" and "Kyle" have zero rows in ITEMS — still selectable.
    expect(screen.getByRole("option", { name: "Anthony" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Kyle" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: "Anthony" }));
    expect(screen.getByText("No Podcast work matches these filters.")).toBeInTheDocument();
  });

  it("shows Clear filters only once a filter is active, and it resets everything", () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);

    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search Podcast SEO work"), { target: { value: "hvac" } });
    const clear = screen.getByRole("button", { name: "Clear filters" });
    fireEvent.click(clear);

    expect(screen.getByLabelText("Search Podcast SEO work")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    expect(within(table()).getByText("seeitgonejunkremoval.com")).toBeInTheDocument();
  });
});

describe("PodcastSeoWorkflowView — SEO Success Blueprint displays as SBP", () => {
  const SBP_ITEMS: PodcastOperationItem[] = [
    item({
      id: "1",
      clientName: "https://seeitgonejunkremoval.com/wp-admin",
      rawSeoPackage: "Platinum SEO Success Blueprint (100 Targeted Keywords)",
      workLabel: "Platinum SBP (100 Targeted Keywords) 4/4",
    }),
    item({
      id: "2",
      clientName: "https://www.blairllc.com/",
      rawSeoPackage: "Starter",
      workLabel: "Starter 4/4",
    }),
  ];

  it("shows the abbreviated label in the Work column and the filter options, never the raw phrase", () => {
    render(
      <PodcastSeoWorkflowView items={SBP_ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />,
    );

    expect(within(table()).getByText("Platinum SBP (100 Targeted Keywords) 4/4")).toBeInTheDocument();
    expect(within(table()).queryByText(/Success Blueprint/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(within(screen.getByRole("dialog", { name: "Filters" })).getByRole("button", { name: "Platinum SBP (100 Targeted Keywords) 4/4" })).toBeInTheDocument();
  });

  it("matches search by the abbreviation \"SBP\"", () => {
    render(
      <PodcastSeoWorkflowView items={SBP_ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />,
    );

    fireEvent.change(screen.getByLabelText("Search Podcast SEO work"), { target: { value: "SBP" } });
    expect(within(table()).getByText("seeitgonejunkremoval.com")).toBeInTheDocument();
    expect(within(table()).queryByText("blairllc.com")).not.toBeInTheDocument();
  });

  it("still matches search by the original phrase \"Success Blueprint\", even though it's shortened for display", () => {
    render(
      <PodcastSeoWorkflowView items={SBP_ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />,
    );

    fireEvent.change(screen.getByLabelText("Search Podcast SEO work"), { target: { value: "Success Blueprint" } });
    expect(within(table()).getByText("seeitgonejunkremoval.com")).toBeInTheDocument();
    expect(within(table()).queryByText("blairllc.com")).not.toBeInTheDocument();
  });
});

describe("PodcastSeoWorkflowView — row selection and inspector", () => {
  it("opens the inspector on row click, organized into Overview/Work/Resources/Source tabs", () => {
    render(
      <PodcastSeoWorkflowView
        items={ITEMS}
        sourceMonth="PODCAST AUGUST 2026"
        lastSyncedAt={new Date().toISOString()}
        vaOptions={VA_OPTIONS}
      />,
    );

    openRow(/seeitgonejunkremoval\.com/);
    const inspector = screen.getByRole("dialog");

    // Overview is the default tab, and keeps Assigned VA clearly visible.
    expect(within(inspector).getByRole("tab", { name: "Overview", selected: true })).toBeInTheDocument();
    expect(within(inspector).getByText("acme@example.com")).toBeInTheDocument();
    expect(within(inspector).getByText("WF-1001")).toBeInTheDocument();
    expect(within(inspector).getByText("Jordan")).toBeInTheDocument();

    openInspectorTab("Work");
    expect(within(inspector).getByText("Growth 4/4")).toBeInTheDocument();
    expect(within(inspector).getByText("plumber near me")).toBeInTheDocument();
    expect(within(inspector).getByText("Austin")).toBeInTheDocument();

    openInspectorTab("Resources");
    expect(within(inspector).getByText("Login document")).toBeInTheDocument();
    expect(within(inspector).getByText("Prompt / SOP")).toBeInTheDocument();
    expect(within(inspector).getByText("Output")).toBeInTheDocument();
    expect(within(inspector).getAllByRole("link", { name: "Open" })).toHaveLength(2);
    expect(within(inspector).getByRole("link", { name: "View Output" })).toBeInTheDocument();

    openInspectorTab("Source");
    expect(within(inspector).getAllByText("PODCAST AUGUST 2026").length).toBeGreaterThan(0);
    expect(within(inspector).getByText("Read only")).toBeInTheDocument();
  });

  it("omits Notes when there are none, and shows it when present", () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);

    openRow(/seeitgonejunkremoval\.com/);
    openInspectorTab("Work");
    expect(within(screen.getByRole("dialog")).queryByText("Notes")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    openRow(/blairllc\.com/);
    openInspectorTab("Work");
    expect(within(screen.getByRole("dialog")).getByText("Notes")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("Waiting on client audio")).toBeInTheDocument();
  });

  it("shows an unobtrusive empty state instead of a resources section when none exist", () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);

    openRow(/cedargroup\.example\.com/);
    openInspectorTab("Resources");
    expect(within(screen.getByRole("dialog")).getByText("No resource links on this record.")).toBeInTheDocument();
  });

  it("closes the inspector on Escape", async () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);

    openRow(/seeitgonejunkremoval\.com/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("PodcastSeoWorkflowView — Podcast link resource", () => {
  it("renders View Output when a podcast URL exists, and an unobtrusive empty state when it doesn't", () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);

    // Items 1 and 2 have a podcast URL; item 3 does not.
    expect(within(table()).getAllByRole("link", { name: "View Output" })).toHaveLength(2);
    expect(within(table()).getByText("Not available")).toBeInTheDocument();
  });
});

describe("PodcastSeoWorkflowView — keyboard interaction", () => {
  it("opens the inspector when a focused row receives Enter", () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);

    const row = screen.getByRole("row", { name: /seeitgonejunkremoval\.com/ });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the inspector when a focused row receives Space", () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);

    const row = screen.getByRole("row", { name: /seeitgonejunkremoval\.com/ });
    fireEvent.keyDown(row, { key: " " });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("every worklist row is a real, independently focusable table row", () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);

    const rows = within(table()).getAllByRole("row").slice(1); // drop the header row
    for (const row of rows) {
      expect(row).toHaveAttribute("tabindex", "0");
    }
  });
});

describe("PodcastSeoWorkflowView — mobile rendering", () => {
  it("renders an equivalent divider-separated list alongside the table", () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);

    const mobileList = screen.getByRole("list");
    expect(within(mobileList).getByText("seeitgonejunkremoval.com")).toBeInTheDocument();
    expect(within(mobileList).getAllByRole("button")).toHaveLength(3);
  });

  it("opens the same inspector from the mobile list", () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);

    fireEvent.click(within(screen.getByRole("list")).getByRole("button", { name: /seeitgonejunkremoval\.com/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("PodcastSeoWorkflowView — background refresh preserves state", () => {
  it("keeps active filters when the items prop changes (e.g. a realtime refetch)", () => {
    const { rerender } = render(
      <PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />,
    );

    fireEvent.change(screen.getByLabelText("Search Podcast SEO work"), { target: { value: "hvac" } });
    expect(within(table()).getByText("blairllc.com")).toBeInTheDocument();

    const refreshed = ITEMS.map((entry) => ({ ...entry }));
    rerender(
      <PodcastSeoWorkflowView
        items={refreshed}
        sourceMonth="PODCAST AUGUST 2026"
        lastSyncedAt={new Date().toISOString()}
        vaOptions={VA_OPTIONS}
      />,
    );

    expect(screen.getByLabelText("Search Podcast SEO work")).toHaveValue("hvac");
    expect(within(table()).getByText("blairllc.com")).toBeInTheDocument();
    expect(within(table()).queryByText("seeitgonejunkremoval.com")).not.toBeInTheDocument();
  });

  it("updates an open inspector in place when the selected record changes on refresh", () => {
    const { rerender } = render(
      <PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />,
    );

    openRow(/seeitgonejunkremoval\.com/);
    expect(within(screen.getByRole("dialog")).getByText(/In Progress/)).toBeInTheDocument();

    const updated = ITEMS.map((entry) => (entry.id === "1" ? { ...entry, normalizedStatus: "completed" as const, rawStatus: "Completed" } : entry));
    rerender(
      <PodcastSeoWorkflowView
        items={updated}
        sourceMonth="PODCAST AUGUST 2026"
        lastSyncedAt={new Date().toISOString()}
        vaOptions={VA_OPTIONS}
      />,
    );

    expect(within(screen.getByRole("dialog")).getByText(/Completed/)).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).queryByText(/In Progress/)).not.toBeInTheDocument();
  });

  it("closes the inspector automatically if the selected record disappears from a refresh", async () => {
    const { rerender } = render(
      <PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />,
    );

    openRow(/seeitgonejunkremoval\.com/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const withoutSelected = ITEMS.filter((entry) => entry.id !== "1");
    rerender(
      <PodcastSeoWorkflowView
        items={withoutSelected}
        sourceMonth="PODCAST AUGUST 2026"
        lastSyncedAt={new Date().toISOString()}
        vaOptions={VA_OPTIONS}
      />,
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("PodcastSeoWorkflowView — month selector", () => {
  const MONTH_OPTIONS = [
    { value: "2026-08", label: "August 2026", tabTitle: "PODCAST AUGUST 2026" },
    { value: "2026-07", label: "July 2026", tabTitle: "PODCAST JULY 2026" },
  ];

  it("does not render a selector when there are no discovered months", () => {
    render(<PodcastSeoWorkflowView items={ITEMS} sourceMonth="PODCAST AUGUST 2026" lastSyncedAt={null} vaOptions={VA_OPTIONS} />);
    expect(screen.queryByRole("button", { name: /^Month:/ })).not.toBeInTheDocument();
  });

  it("lives in the same toolbar row as Search/VA/Filters/Status, in Search → VA → Filters → Status → Month order — not a separate floating control above the filters", () => {
    render(
      <PodcastSeoWorkflowView
        items={ITEMS}
        sourceMonth="PODCAST AUGUST 2026"
        lastSyncedAt={null}
        vaOptions={VA_OPTIONS}
        monthOptions={MONTH_OPTIONS}
        selectedMonth="2026-08"
      />,
    );

    const search = screen.getByLabelText("Search Podcast SEO work");
    const vaTrigger = screen.getByRole("button", { name: /^Filter by assigned VA:/ });
    const filtersTrigger = screen.getByRole("button", { name: "Filters" });
    const statusTrigger = screen.getByRole("button", { name: /^Filter by status:/ });
    const monthTrigger = screen.getByRole("button", { name: /^Month: August 2026/ });

    const toolbar = document.querySelector(".dept-toolbar");
    expect(toolbar).not.toBeNull();
    for (const control of [search, vaTrigger, filtersTrigger, statusTrigger, monthTrigger]) {
      expect(toolbar?.contains(control)).toBe(true);
    }

    // DOCUMENT_POSITION_FOLLOWING (4) means the first node precedes the second.
    expect(search.compareDocumentPosition(vaTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(vaTrigger.compareDocumentPosition(filtersTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(filtersTrigger.compareDocumentPosition(statusTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(statusTrigger.compareDocumentPosition(monthTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the selector with the resolved month selected, newest-first option order", () => {
    render(
      <PodcastSeoWorkflowView
        items={ITEMS}
        sourceMonth="PODCAST AUGUST 2026"
        lastSyncedAt={null}
        vaOptions={VA_OPTIONS}
        monthOptions={MONTH_OPTIONS}
        selectedMonth="2026-08"
      />,
    );

    const trigger = screen.getByRole("button", { name: /^Month: August 2026/ });
    fireEvent.click(trigger);
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["August 2026", "July 2026"]);
  });

  it("calls onMonthChange with the chosen option's value", () => {
    const onMonthChange = vi.fn();
    render(
      <PodcastSeoWorkflowView
        items={ITEMS}
        sourceMonth="PODCAST AUGUST 2026"
        lastSyncedAt={null}
        vaOptions={VA_OPTIONS}
        monthOptions={MONTH_OPTIONS}
        selectedMonth="2026-08"
        onMonthChange={onMonthChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Month:/ }));
    fireEvent.click(screen.getByRole("option", { name: "July 2026" }));

    expect(onMonthChange).toHaveBeenCalledWith("2026-07");
  });

  it("resets active filters and closes the inspector when sourceMonth changes, but not on a same-month refresh", async () => {
    const { rerender } = render(
      <PodcastSeoWorkflowView
        items={ITEMS}
        sourceMonth="PODCAST AUGUST 2026"
        lastSyncedAt={null}
        vaOptions={VA_OPTIONS}
        monthOptions={MONTH_OPTIONS}
        selectedMonth="2026-08"
      />,
    );

    fireEvent.change(screen.getByLabelText("Search Podcast SEO work"), { target: { value: "hvac" } });
    openRow(/blairllc\.com/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Same month, refreshed items (background live-sync) — filters/inspector survive.
    rerender(
      <PodcastSeoWorkflowView
        items={ITEMS.map((entry) => ({ ...entry }))}
        sourceMonth="PODCAST AUGUST 2026"
        lastSyncedAt={new Date().toISOString()}
        vaOptions={VA_OPTIONS}
        monthOptions={MONTH_OPTIONS}
        selectedMonth="2026-08"
      />,
    );
    expect(screen.getByLabelText("Search Podcast SEO work")).toHaveValue("hvac");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // A genuine month change — filters and the open inspector must not carry over.
    const julyItems: PodcastOperationItem[] = [item({ id: "j1", clientName: "https://julyclient.example", sourceMonth: "PODCAST JULY 2026" })];
    rerender(
      <PodcastSeoWorkflowView
        items={julyItems}
        sourceMonth="PODCAST JULY 2026"
        lastSyncedAt={new Date().toISOString()}
        vaOptions={[]}
        monthOptions={MONTH_OPTIONS}
        selectedMonth="2026-07"
      />,
    );

    expect(screen.getByLabelText("Search Podcast SEO work")).toHaveValue("");
    // The inspector's own 200ms exit transition keeps it mounted (closing) for a moment — matches the
    // established "closes the inspector on Escape" assertion pattern elsewhere in this file.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(table()).getByText("julyclient.example")).toBeInTheDocument();
  });
});
