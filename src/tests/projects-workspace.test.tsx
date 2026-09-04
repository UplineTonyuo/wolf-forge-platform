/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROJECTS_BULK_ACTION_EVENT,
  type ProjectBulkActionKind,
} from "../components/projects/projects-events";

const refresh = vi.fn();
const bulkChangeProjectStatusAction = vi.fn();
const bulkAssignProjectsAction = vi.fn();
const bulkArchiveProjectsAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

// The real action module reaches the server-only Supabase context, so the
// component is exercised against the same action contract without it.
vi.mock("../app/actions/orders", () => ({
  bulkChangeProjectStatusAction: (...args: unknown[]) => bulkChangeProjectStatusAction(...args),
  bulkAssignProjectsAction: (...args: unknown[]) => bulkAssignProjectsAction(...args),
  bulkArchiveProjectsAction: (...args: unknown[]) => bulkArchiveProjectsAction(...args),
}));

const { composeProjectRows } = await import("../domain/orders/projections");
const { ProjectsWorkspace } = await import("../components/projects/projects-workspace");

type RelationRow = Parameters<typeof composeProjectRows>[0][number];

const now = new Date("2026-08-13T12:00:00.000Z");
const anthony = "a0000000-0000-4000-8000-000000000001";

function order(id: string, overrides: Partial<RelationRow>): RelationRow {
  return {
    id,
    order_number: 100,
    company_id: "c0000000-0000-4000-8000-000000000001",
    service_id: "50000000-0000-4000-8000-000000000001",
    assigned_to_profile_id: null,
    title: "Untitled",
    status: "pending",
    priority: "normal",
    due_at: null,
    started_at: null,
    completed_at: null,
    notes: null,
    created_at: "2026-08-12T09:00:00.000Z",
    updated_at: "2026-08-12T09:00:00.000Z",
    archived_at: null,
    companies: { id: "c0000000-0000-4000-8000-000000000001", name: "Kraken Junk Removal" },
    services: { id: "50000000-0000-4000-8000-000000000001", name: "SEO Sprint" },
    profiles: null,
    ...overrides,
  } as RelationRow;
}

const rows = composeProjectRows(
  [
    order("10000000-0000-4000-8000-000000000001", {
      order_number: 101,
      title: "Local SEO Growth Campaign",
      status: "working",
      assigned_to_profile_id: anthony,
      profiles: { id: anthony, display_name: "Anthony Paghubasan" },
    }),
    order("10000000-0000-4000-8000-000000000002", {
      order_number: 102,
      title: "Foundation Build",
      status: "waiting_reply",
      company_id: "c0000000-0000-4000-8000-000000000002",
      companies: { id: "c0000000-0000-4000-8000-000000000002", name: "Junk Buddies" },
    }),
    order("10000000-0000-4000-8000-000000000003", {
      order_number: 103,
      title: "Maps Ranking Campaign",
      status: "pending",
    }),
  ],
  [{ order_id: "10000000-0000-4000-8000-000000000003", status: "todo", due_at: "2026-08-01T09:00:00.000Z" }],
  now,
);

const capabilities = { create: true, edit: true, assign: true, archive: true };

function renderWorkspace(overrides: Partial<Parameters<typeof ProjectsWorkspace>[0]> = {}) {
  return render(
    <ProjectsWorkspace
      rows={rows}
      complete
      people={[{ id: anthony, name: "Anthony Paghubasan" }]}
      services={[{ id: "50000000-0000-4000-8000-000000000001", name: "SEO Sprint" }]}
      clients={[
        { id: "c0000000-0000-4000-8000-000000000001", name: "Kraken Junk Removal" },
        { id: "c0000000-0000-4000-8000-000000000002", name: "Junk Buddies" },
      ]}
      capabilities={capabilities}
      {...overrides}
    />,
  );
}

function tab(label: string) {
  return screen.getByRole("button", { name: new RegExp(`^${label}`, "u") });
}

function rowCount() {
  return screen.getAllByRole("button", { name: /^Select .* project /u }).length;
}

function requestBulkAction(kind: ProjectBulkActionKind) {
  fireEvent(window, new CustomEvent(PROJECTS_BULK_ACTION_EVENT, { detail: { kind } }));
}

beforeEach(() => {
  refresh.mockReset();
  bulkChangeProjectStatusAction.mockReset();
  bulkAssignProjectsAction.mockReset();
  bulkArchiveProjectsAction.mockReset();
});

afterEach(cleanup);

describe("Projects workspace renders real data", () => {
  it("renders one row per authorized project with its real client, title and service", () => {
    renderWorkspace();

    expect(rowCount()).toBe(3);
    expect(screen.getByText("Local SEO Growth Campaign")).toBeTruthy();
    expect(screen.getAllByText("Kraken Junk Removal").length).toBeGreaterThan(0);
    expect(screen.getByText("Junk Buddies")).toBeTruthy();
    expect(screen.getAllByText("SEO Sprint").length).toBeGreaterThan(0);
    expect(screen.getByText("Anthony Paghubasan")).toBeTruthy();
    expect(screen.getAllByText("Unassigned").length).toBe(2);
  });

  it("does not display any monetary project value", () => {
    const { container } = renderWorkspace();
    expect(container.textContent).not.toMatch(/\$\d/u);
  });

  it("shows project status and creation metadata without message counts", () => {
    renderWorkspace();
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getAllByText("Aug 12")).toHaveLength(3);
    expect(screen.queryByText(/messages?/iu)).toBeNull();
  });

  it("links every project row to its detail route", () => {
    renderWorkspace();
    const link = screen.getByRole("link", { name: /Local SEO Growth Campaign/u });
    expect(link.getAttribute("href")).toBe("/orders/10000000-0000-4000-8000-000000000001");
  });
});

describe("Projects status tabs and counts", () => {
  it("shows counts that match the rows each tab renders", () => {
    renderWorkspace();

    expect(within(tab("All")).getByText("3")).toBeTruthy();
    expect(within(tab("Waiting Reply")).getByText("1")).toBeTruthy();

    fireEvent.click(tab("Waiting Reply"));
    expect(rowCount()).toBe(1);
    expect(screen.getByText("Foundation Build")).toBeTruthy();

    fireEvent.click(tab("Pending Update"));
    expect(screen.queryAllByRole("button", { name: /^Select .* project /u })).toHaveLength(0);
    expect(screen.getByText("No projects match this view")).toBeTruthy();
  });
});

describe("Projects attention system", () => {
  it("counts waiting_reply and overdue-task projects with one predicate", () => {
    renderWorkspace();
    expect(screen.getByText("projects need attention.")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("filters to exactly the projects the banner counted", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "View" }));

    expect(rowCount()).toBe(2);
    expect(screen.getByText("Foundation Build")).toBeTruthy();
    expect(screen.getByText("Maps Ranking Campaign")).toBeTruthy();
    expect(screen.queryByText("Local SEO Growth Campaign")).toBeNull();
  });
});

describe("Projects filters and search", () => {
  it("searches by title, project number and client name", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));

    const input = screen.getByLabelText("Search");
    fireEvent.change(input, { target: { value: "junk buddies" } });
    expect(rowCount()).toBe(1);
    expect(screen.getByText("Foundation Build")).toBeTruthy();

    fireEvent.change(input, { target: { value: "103" } });
    expect(rowCount()).toBe(1);
    expect(screen.getByText("Maps Ranking Campaign")).toBeTruthy();

    fireEvent.change(input, { target: { value: "growth" } });
    expect(rowCount()).toBe(1);
    expect(screen.getByText("Local SEO Growth Campaign")).toBeTruthy();
  });

  it("filters by real person, service and client options", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));

    fireEvent.change(screen.getByLabelText("Person"), { target: { value: anthony } });
    expect(rowCount()).toBe(1);

    fireEvent.change(screen.getByLabelText("Person"), { target: { value: "unassigned" } });
    expect(rowCount()).toBe(2);

    fireEvent.change(screen.getByLabelText("Person"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Client"), {
      target: { value: "c0000000-0000-4000-8000-000000000002" },
    });
    expect(rowCount()).toBe(1);
    expect(screen.getByText("Foundation Build")).toBeTruthy();
  });

  it("keeps counts consistent with an active filter", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/u }));
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "kraken" } });

    expect(within(tab("All")).getByText("2")).toBeTruthy();
    fireEvent.click(tab("All"));
    expect(rowCount()).toBe(2);
  });
});

describe("Projects selection", () => {
  it("selects a single row and reports it in the footer", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /^Select Junk Buddies project/u }));

    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("selects and clears every visible row", () => {
    renderWorkspace();
    const selectAll = screen.getByRole("button", { name: "Select all visible projects" });

    fireEvent.click(selectAll);
    expect(screen.getByText("3 selected")).toBeTruthy();
    expect(selectAll.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(selectAll);
    expect(screen.getByText("0 selected")).toBeTruthy();
  });

  it("only selects rows in the current view", () => {
    renderWorkspace();
    fireEvent.click(tab("Waiting Reply"));
    fireEvent.click(screen.getByRole("button", { name: "Select all visible projects" }));

    expect(screen.getByText("1 selected")).toBeTruthy();
  });
});

describe("Projects action controls", () => {
  it("ignores bulk-action requests until projects are selected", () => {
    renderWorkspace();
    requestBulkAction("assign");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("links accounts with create capability to the new-project flow", () => {
    renderWorkspace();
    expect(screen.getByRole("link", { name: "New Project" }).getAttribute("href")).toBe("/orders/new");
  });

  it("hides the new-project action without create capability", () => {
    renderWorkspace({ capabilities: { create: false, edit: false, assign: false, archive: false } });
    expect(screen.queryByRole("link", { name: "New Project" })).toBeNull();
  });

  it("sends selected project ids to the bulk status action and refreshes on success", async () => {
    bulkChangeProjectStatusAction.mockResolvedValue({
      attempted: 3,
      succeeded: rows.map((row) => ({ id: row.id, label: `#${row.orderNumber} ${row.title}` })),
      failed: [],
    });

    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Select all visible projects" }));
    requestBulkAction("status");

    fireEvent.change(screen.getByLabelText(/New status/u), { target: { value: "complete" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await screen.findByText("3 projects updated.");
    expect(bulkChangeProjectStatusAction).toHaveBeenCalledWith(
      rows.map((row) => row.id),
      "complete",
    );
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("0 selected")).toBeTruthy();
  });

  it("reports a partial bulk failure honestly and keeps the failed rows selected", async () => {
    bulkArchiveProjectsAction.mockResolvedValue({
      attempted: 3,
      succeeded: [
        { id: rows[0]!.id, label: "#101 Local SEO Growth Campaign" },
        { id: rows[1]!.id, label: "#102 Foundation Build" },
      ],
      failed: [
        {
          id: rows[2]!.id,
          label: "#103 Maps Ranking Campaign",
          error: "You do not have permission to perform this action.",
        },
      ],
    });

    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Select all visible projects" }));
    requestBulkAction("archive");
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await screen.findByText("2 of 3 projects updated. 1 failed.");
    expect(screen.getByText(/#103 Maps Ranking Campaign/u)).toBeTruthy();
    expect(screen.getByText("You do not have permission to perform this action.")).toBeTruthy();
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("surfaces a failed single-project assignment without claiming success", async () => {
    bulkAssignProjectsAction.mockResolvedValue({
      attempted: 1,
      succeeded: [],
      failed: [
        { id: rows[0]!.id, label: "#101 Local SEO Growth Campaign", error: "That teammate cannot be assigned." },
      ],
    });

    renderWorkspace();
    fireEvent.click(
      screen.getByRole("button", { name: "Select Kraken Junk Removal project Local SEO Growth Campaign" }),
    );
    requestBulkAction("assign");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await screen.findByText("No projects were updated. 1 failed.");
    expect(bulkAssignProjectsAction).toHaveBeenCalledWith([rows[0]!.id], null);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("closes the confirmation dialog with the keyboard", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Select all visible projects" }));
    requestBulkAction("archive");

    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Projects empty and incomplete states", () => {
  it("shows an honest empty state when there are no projects at all", () => {
    renderWorkspace({ rows: [] });
    expect(screen.getByText("No projects yet")).toBeTruthy();
    expect(screen.getByText("0 projects")).toBeTruthy();
  });

  it("warns that counts are incomplete rather than presenting partial totals", () => {
    renderWorkspace({ complete: false });
    expect(screen.getByRole("alert").textContent).toMatch(/tab counts below are incomplete/u);
  });
});
