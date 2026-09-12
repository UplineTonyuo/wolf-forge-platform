/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const bulkArchiveClientsAction = vi.fn();
const bulkChangeClientStatusAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("../app/actions/clients", () => ({
  bulkArchiveClientsAction: (...args: unknown[]) => bulkArchiveClientsAction(...args),
  bulkChangeClientStatusAction: (...args: unknown[]) => bulkChangeClientStatusAction(...args),
}));

const { ClientsTable } = await import("../components/clients/clients-table");

const statuses = [
  { value: "contact", label: "Contact" },
  { value: "lead", label: "Lead" },
  { value: "client", label: "Client" },
  { value: "client_team", label: "Client Team" },
];

const rows = [
  { id: "10000000-0000-4000-8000-000000000001", name: "Acme", createdLabel: "Sep 1", status: "client", statusLabel: "Client" },
  { id: "10000000-0000-4000-8000-000000000002", name: "Beacon", createdLabel: "Sep 2", status: "lead", statusLabel: "Lead" },
  { id: "10000000-0000-4000-8000-000000000003", name: "Cedar", createdLabel: "Sep 3", status: "contact", statusLabel: "Contact" },
];

function renderTable(visibleRows = rows, key = "all") {
  return render(
    <ClientsTable
      key={key}
      rows={visibleRows}
      statuses={statuses}
      canEdit
      canDelete
    />,
  );
}

beforeEach(() => {
  refresh.mockReset();
  bulkArchiveClientsAction.mockReset();
  bulkChangeClientStatusAction.mockReset();
});

afterEach(cleanup);

describe("Clients table selection", () => {
  it("selects rows accessibly and marks select-all indeterminate", () => {
    renderTable();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Acme" }));

    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Select all visible clients" })).toHaveProperty(
      "indeterminate",
      true,
    );
    expect(
      screen.getByRole("checkbox", { name: "Select Acme" }).closest("tr")?.classList.contains(
        "is-selected",
      ),
    ).toBe(true);
  });

  it("selects all visible rows and clears selection when the filter view changes", () => {
    const view = renderTable();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible clients" }));

    expect(screen.getByText("3 selected")).toBeTruthy();

    view.rerender(
      <ClientsTable
        key="lead-filter"
        rows={[rows[1]!]}
        statuses={statuses}
        canEdit
        canDelete
      />,
    );

    expect(screen.getByText("0 selected")).toBeTruthy();
    expect(
      (screen.getByRole("checkbox", { name: "Select all visible clients" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
  });
});

describe("Clients bulk actions", () => {
  it("changes status through the existing mutation and clears successful selection", async () => {
    bulkChangeClientStatusAction.mockResolvedValue({
      attempted: 3,
      succeeded: rows.map((row) => ({ id: row.id, label: row.name })),
      failed: [],
    });
    renderTable();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible clients" }));
    fireEvent.change(screen.getByLabelText("Bulk action"), { target: { value: "status" } });
    fireEvent.change(screen.getByLabelText("New client status"), { target: { value: "client_team" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await screen.findByText("3 clients updated.");
    expect(bulkChangeClientStatusAction).toHaveBeenCalledWith(
      rows.map((row) => row.id),
      "client_team",
    );
    expect(screen.getByText("0 selected")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("requires counted delete confirmation and keeps only failed rows selected", async () => {
    bulkArchiveClientsAction.mockResolvedValue({
      attempted: 3,
      succeeded: rows.slice(0, 2).map((row) => ({ id: row.id, label: row.name })),
      failed: [{ id: rows[2]!.id, label: "Cedar", error: "Linked records prevent deletion." }],
    });
    renderTable();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible clients" }));
    fireEvent.change(screen.getByLabelText("Bulk action"), { target: { value: "delete" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByRole("dialog").textContent).toContain("Delete 3 clients?");
    expect(bulkArchiveClientsAction).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));

    const deleteButton = screen.getByRole("button", { name: "Delete 3 clients" });
    deleteButton.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(deleteButton);

    await screen.findByText("2 of 3 clients deleted. 1 failed.");
    expect(screen.getByText("Linked records prevent deletion.")).toBeTruthy();
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("does not invent a manager mutation that the Clients model cannot store", () => {
    renderTable();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Acme" }));
    fireEvent.change(screen.getByLabelText("Bulk action"), { target: { value: "manager" } });

    expect(screen.getByText(/manager assignment is not available/iu)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
