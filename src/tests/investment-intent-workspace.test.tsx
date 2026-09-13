/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateInvestmentIntentStatusAction = vi.fn();

vi.mock("../app/actions/store-interest", () => ({
  updateInvestmentIntentStatusAction: (input: unknown) =>
    updateInvestmentIntentStatusAction(input),
}));

const { InvestmentIntentWorkspace } = await import(
  "../components/investment-intent/investment-intent-workspace"
);

const { toInvestmentIntentViews } = await import("../domain/store-interest/projections");

import type { InvestmentIntentRow } from "../domain/store-interest/schema";

function row(overrides: Partial<InvestmentIntentRow> = {}): InvestmentIntentRow {
  return {
    intent_id: "intent-1",
    company_id: "company-1",
    company_name: "Northgate Dental",
    service_id: "service-1",
    service_name: "Local SEO",
    folder_name: "Search",
    price: 500,
    currency: "USD",
    recurring: false,
    recurring_price: null,
    recurring_interval_length: null,
    recurring_interval_unit: null,
    status: "new",
    in_cart: true,
    add_count: 1,
    first_added_at: "2026-08-01T10:00:00.000Z",
    last_added_at: "2026-08-01T10:00:00.000Z",
    removed_at: null,
    last_activity_at: "2026-08-01T10:00:00.000Z",
    contacted_at: null,
    contacted_by_profile_id: null,
    contacted_by_name: null,
    updated_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

const intents = toInvestmentIntentViews([
  row({
    intent_id: "newest",
    company_id: "company-2",
    company_name: "Southgate Legal",
    service_id: "service-2",
    service_name: "Press Releases",
    last_activity_at: "2026-08-09T10:00:00.000Z",
  }),
  row({
    intent_id: "renewed",
    company_name: "Northgate Dental",
    add_count: 3,
    status: "closed",
    last_activity_at: "2026-08-05T10:00:00.000Z",
  }),
  row({
    intent_id: "dropped",
    company_name: "Westgate Auto",
    company_id: "company-3",
    status: "contacted",
    in_cart: false,
    removed_at: "2026-08-02T10:00:00.000Z",
    last_activity_at: "2026-08-02T10:00:00.000Z",
    contacted_by_name: "William",
  }),
]);

/** The desktop table is the surface under test; the mobile list mirrors it. */
function tableRows(): HTMLElement[] {
  const table = screen.getByRole("table");
  return within(table).getAllByRole("row").slice(1);
}

beforeEach(() => {
  updateInvestmentIntentStatusAction.mockReset();
  updateInvestmentIntentStatusAction.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
});

describe("Investment Intent workspace", () => {
  it("leads with the most recent buying signal", () => {
    render(<InvestmentIntentWorkspace intents={intents} />);

    const first = tableRows()[0]!;
    expect(within(first).getByText("Southgate Legal")).toBeInTheDocument();
  });

  it("shows what a client is interested in and what it costs", () => {
    render(<InvestmentIntentWorkspace intents={intents} />);

    const first = tableRows()[0]!;
    expect(within(first).getByText("Press Releases")).toBeInTheDocument();
    expect(within(first).getByText("$500")).toBeInTheDocument();
    expect(within(first).getByText("One-time")).toBeInTheDocument();
  });

  it("distinguishes a live cart from a preserved removal", () => {
    render(<InvestmentIntentWorkspace intents={intents} />);

    const table = screen.getByRole("table");
    expect(within(table).getAllByText("In cart").length).toBeGreaterThan(0);
    // The dropped interest is still listed rather than deleted.
    expect(within(table).getByText("Westgate Auto")).toBeInTheDocument();
    expect(within(table).getByText("Removed")).toBeInTheDocument();
  });

  it("describes cart state as the latest recorded activity rather than live state", () => {
    render(<InvestmentIntentWorkspace intents={intents} />);

    expect(screen.getAllByTitle("Cart state reflects the latest recorded client activity.").length)
      .toBeGreaterThan(0);
  });

  it("marks renewed interest without inventing a seventh status", () => {
    render(<InvestmentIntentWorkspace intents={intents} />);

    const table = screen.getByRole("table");
    expect(within(table).getByText("Renewed")).toBeInTheDocument();
    // Renewed is a signal beside a status, never a status itself.
    expect(screen.queryByRole("option", { name: "Renewed" })).not.toBeInTheDocument();
  });

  it("counts interest without ever printing a combined money total", () => {
    render(<InvestmentIntentWorkspace intents={intents} />);

    const summary = screen.getByText("Interests").closest("dl")!;
    expect(within(summary).getByText("3")).toBeInTheDocument();
    expect(summary.textContent).not.toMatch(/\$/u);
  });

  it("filters by workflow status", () => {
    render(<InvestmentIntentWorkspace intents={intents} />);

    fireEvent.click(screen.getByRole("button", { name: /^Contacted/u }));

    const rows = tableRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText("Westgate Auto")).toBeInTheDocument();
  });

  it("narrows to interests still in a cart", () => {
    render(<InvestmentIntentWorkspace intents={intents} />);

    fireEvent.click(screen.getByRole("button", { name: /^In cart/u }));

    expect(tableRows()).toHaveLength(2);
    expect(screen.queryByText("Westgate Auto")).not.toBeInTheDocument();
  });

  it("searches across client and investment", () => {
    render(<InvestmentIntentWorkspace intents={intents} />);

    fireEvent.change(screen.getByPlaceholderText("Search client or investment"), {
      target: { value: "press" },
    });

    const rows = tableRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText("Southgate Legal")).toBeInTheDocument();
  });

  it("links to the client and to the investment", () => {
    render(<InvestmentIntentWorkspace intents={intents} />);

    const first = tableRows()[0]!;
    expect(within(first).getByRole("link", { name: /Open client/u })).toHaveAttribute(
      "href",
      "/clients/company-2",
    );
    expect(within(first).getByRole("link", { name: /Open investment/u })).toHaveAttribute(
      "href",
      "/services/service-2",
    );
  });

  it("shows a read-only status without the manage capability", () => {
    render(<InvestmentIntentWorkspace intents={intents} canManage={false} />);

    const table = screen.getByRole("table");
    expect(within(table).getAllByText("New").length).toBeGreaterThan(0);
    // No control to change it, and no action to call.
    expect(screen.queryByRole("button", { name: /^Status:/u })).not.toBeInTheDocument();
    expect(updateInvestmentIntentStatusAction).not.toHaveBeenCalled();
  });

  it("moves an intent through the workflow when permitted", async () => {
    render(<InvestmentIntentWorkspace intents={intents} canManage={true} />);

    const first = tableRows()[0]!;
    fireEvent.click(within(first).getByRole("button", { name: /^Status:/u }));
    fireEvent.click(await screen.findByRole("option", { name: "Reviewing" }));

    expect(updateInvestmentIntentStatusAction).toHaveBeenCalledWith({
      intentId: "newest",
      status: "reviewing",
    });
  });

  it("shows a real busy state on the status control while the mutation is in flight, never a fixed delay", async () => {
    let resolveMutation!: (value: { ok: true }) => void;
    updateInvestmentIntentStatusAction.mockReturnValue(
      new Promise((resolve) => {
        resolveMutation = resolve;
      }),
    );

    render(<InvestmentIntentWorkspace intents={intents} canManage={true} />);

    const first = tableRows()[0]!;
    const trigger = within(first).getByRole("button", { name: /^Status:/u });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "Reviewing" }));

    expect(trigger).toHaveAttribute("aria-busy", "true");
    expect(trigger).toBeDisabled();

    resolveMutation({ ok: true });
    await waitFor(() => expect(trigger).not.toHaveAttribute("aria-busy"));
    expect(trigger).toBeEnabled();
  });

  it("reports a rejected status change instead of pretending it applied", async () => {
    updateInvestmentIntentStatusAction.mockResolvedValue({
      ok: false,
      error: "You do not have permission.",
    });

    render(<InvestmentIntentWorkspace intents={intents} canManage={true} />);

    const first = tableRows()[0]!;
    fireEvent.click(within(first).getByRole("button", { name: /^Status:/u }));
    fireEvent.click(await screen.findByRole("option", { name: "Qualified" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission.");
    // The row keeps the status the server still holds.
    expect(
      within(tableRows()[0]!).getByRole("button", { name: /^Status:/u }),
    ).toHaveAccessibleName("Status: New");
  });

  it("highlights the row a notification pointed at", () => {
    const { container } = render(
      <InvestmentIntentWorkspace intents={intents} focusIntentId="dropped" />,
    );

    const focused = container.querySelectorAll("tr[data-focused]");
    expect(focused).toHaveLength(1);
    expect(focused[0]).toHaveTextContent("Westgate Auto");
  });

  it("explains itself when no client has shown interest yet", () => {
    render(<InvestmentIntentWorkspace intents={[]} />);

    expect(screen.getByText("No investment interest yet")).toBeInTheDocument();
    expect(screen.getByText(/adds an investment to their Store cart/u)).toBeInTheDocument();
  });
});
