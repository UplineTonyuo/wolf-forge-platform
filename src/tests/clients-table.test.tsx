/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const { ClientsTable, clientInitials } = await import("../components/clients/clients-table");

const statuses = [
  { value: "contact", label: "Contact" },
  { value: "lead", label: "Lead" },
  { value: "client", label: "Client" },
  { value: "client_team", label: "Client Team" },
];

const rows = [
  { id: "10000000-0000-4000-8000-000000000001", name: "Matt Quinn", companyName: "Acme", email: "matt@example.com", avatarUrl: "https://example.invalid/matt.jpg", createdLabel: "Sep 1", status: "client", statusLabel: "Client" },
  { id: "10000000-0000-4000-8000-000000000002", name: "Beacon", companyName: "Beacon", createdLabel: "Sep 2", status: "lead", statusLabel: "Lead" },
  { id: "10000000-0000-4000-8000-000000000003", name: "Cedar", companyName: "Cedar", createdLabel: "Sep 3", status: "contact", statusLabel: "Contact" },
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
  it("creates compact, trimmed initials and renders the initials fallback", () => {
    expect(clientInitials("  Matt   Quinn ")).toBe("MQ");
    expect(clientInitials("Clemens Bouter")).toBe("CB");
    expect(clientInitials(" Stan ")).toBe("S");
    expect(clientInitials("Mary Jane Watson")).toBe("MW");

    const view = renderTable();
    const image = view.container.querySelector(".clients-table-avatar img");
    expect(image).toBeTruthy();
    fireEvent.error(image!);
    expect(screen.getByText("MQ")).toBeTruthy();
    expect(view.container.querySelector(".clients-table-avatar img")).toBeNull();
  });

  it("routes Edit accessibly and distinguishes pointer from keyboard menu motion", async () => {
    renderTable();
    const trigger = screen.getByRole("button", { name: "Actions for Matt Quinn" });

    fireEvent.click(trigger);
    expect(
      screen.getByRole("menu", { name: "Actions for Matt Quinn" }).getAttribute(
        "data-open-motion",
      ),
    ).toBe("pointer");
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Edit" }), { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "Actions for Matt Quinn" })).toBeNull();
    });

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const edit = screen.getByRole("menuitem", { name: "Edit" });
    expect(edit.closest('[role="menu"]')?.getAttribute("data-open-motion")).toBe("keyboard");
    expect(edit.getAttribute("href")).toBe(`/clients/${rows[0]!.id}`);

    fireEvent.keyDown(edit, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });

  it("selects rows accessibly and marks select-all indeterminate", () => {
    renderTable();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Matt Quinn" }));

    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Select all visible clients" })).toHaveProperty(
      "indeterminate",
      true,
    );
    expect(
      screen.getByRole("checkbox", { name: "Select Matt Quinn" }).closest("tr")?.classList.contains(
        "is-selected",
      ),
    ).toBe(true);
  });

  it("renders a real Check/Minus icon pair per checkbox, not the retired border-trick glyph", () => {
    renderTable();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Matt Quinn" }));

    const rowWrap = screen
      .getByRole("checkbox", { name: "Select Matt Quinn" })
      .closest(".clients-checkbox-wrap");
    expect(rowWrap?.querySelector(".clients-checkbox-icon-check")).toBeTruthy();
    expect(rowWrap?.querySelector(".clients-checkbox-icon-indeterminate")).toBeTruthy();

    const headerWrap = screen
      .getByRole("checkbox", { name: "Select all visible clients" })
      .closest(".clients-checkbox-wrap");
    expect(headerWrap?.querySelector(".clients-checkbox-icon-check")).toBeTruthy();
    expect(headerWrap?.querySelector(".clients-checkbox-icon-indeterminate")).toBeTruthy();
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
    fireEvent.keyDown(screen.getByRole("button", { name: "Bulk action: Select an action" }), { key: " " });
    expect(
      screen.getByRole("listbox", { name: "Bulk client actions" }).getAttribute(
        "data-open-motion",
      ),
    ).toBe("keyboard");
    fireEvent.click(screen.getByRole("option", { name: "Change status" }));
    fireEvent.click(screen.getByRole("button", { name: "New client status: Contact" }));
    expect(
      screen.getByRole("listbox", { name: "Client statuses" }).getAttribute(
        "data-open-motion",
      ),
    ).toBe("pointer");
    fireEvent.click(screen.getByRole("option", { name: "Client Team" }));
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
    const bulkTrigger = screen.getByRole("button", { name: "Bulk action: Select an action" });
    fireEvent.click(bulkTrigger);
    await waitFor(() => expect(bulkTrigger.getAttribute("aria-expanded")).toBe("true"));
    fireEvent.keyDown(bulkTrigger, { key: "ArrowDown" });
    fireEvent.keyDown(bulkTrigger, { key: "ArrowDown" });
    fireEvent.keyDown(bulkTrigger, { key: "Enter" });
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
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Matt Quinn" }));
    fireEvent.click(screen.getByRole("button", { name: "Bulk action: Select an action" }));

    const manager = screen.getByRole("option", { name: /Assign a manager/iu });

    expect((manager as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Available after assignment setup")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
