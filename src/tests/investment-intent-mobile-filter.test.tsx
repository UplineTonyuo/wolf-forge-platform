/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/actions/store-interest", () => ({
  updateInvestmentIntentStatusAction: vi.fn(async () => ({ ok: true })),
}));

const { InvestmentIntentWorkspace } = await import(
  "../components/investment-intent/investment-intent-workspace"
);
const { investmentIntentStatusLabels, investmentIntentStatuses } = await import(
  "../domain/store-interest/schema"
);

function intent(overrides: {
  id: string;
  companyName: string;
  status: string;
  inCart: boolean;
}) {
  return {
    id: overrides.id,
    companyId: `company-${overrides.id}`,
    companyName: overrides.companyName,
    serviceId: `service-${overrides.id}`,
    serviceName: "SEO Sprint",
    categoryName: null,
    priceLabel: "$97",
    cadence: "one-time" as const,
    status: overrides.status as never,
    inCart: overrides.inCart,
    addCount: 1,
    renewed: false,
    firstAddedAt: "2026-09-01T00:00:00.000Z",
    lastActivityAt: "2026-09-02T00:00:00.000Z",
    removedAt: null,
    contactedAt: null,
    contactedByName: null,
    activeTicketId: null,
    activeTicketStatus: null,
  };
}

const intents = [
  intent({ id: "1", companyName: "Acmecorp", status: "new", inCart: true }),
  intent({ id: "2", companyName: "Beaconltd", status: "qualified", inCart: true }),
  intent({ id: "3", companyName: "Cedargroup", status: "qualified", inCart: false }),
  intent({ id: "4", companyName: "Dunelabs", status: "closed", inCart: false }),
];

function tableRows() {
  /* textContent, not innerText: jsdom does not compute layout. */
  return Array.from(document.querySelectorAll("table tbody tr")).map(
    (row) => row.textContent ?? "",
  );
}

function openFilter() {
  fireEvent.click(screen.getByRole("button", { name: "Filter investment intent" }));
  return screen.getByRole("dialog", { name: "Filter investment intent" });
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Investment Intent filter", () => {
  it("has no status pill row: search leads and the Filter modal is the one entry point", () => {
    render(<InvestmentIntentWorkspace intents={intents} canManage />);

    expect(document.querySelector("[aria-label='Investment intent filters']")).toBeNull();
    expect(screen.queryByRole("button", { name: /^All/ })).toBeNull();

    const search = screen.getByRole("searchbox", { name: "Search investment intent" });
    const trigger = screen.getByRole("button", { name: "Filter investment intent" });
    /* Visible at every width, not only on phones. */
    expect(trigger.className).toMatch(/triggerAlways/);
    /* Search first in the row, Filter after it. */
    expect(search.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers every canonical status plus the cart axis, with the page's own counts", () => {
    render(<InvestmentIntentWorkspace intents={intents} canManage />);
    const dialog = openFilter();

    for (const status of investmentIntentStatuses) {
      const label = investmentIntentStatusLabels[status];
      const row = within(dialog).getByRole("button", { name: new RegExp(`^${label}`) });
      expect(row.textContent).toContain(
        status === "qualified" ? "2" : status === "new" || status === "closed" ? "1" : "0",
      );
    }

    expect(within(dialog).getByRole("button", { name: /^All/ }).textContent).toContain("4");
    expect(within(dialog).getByRole("button", { name: /^In cart/ }).textContent).toContain("2");
  });

  it("opens on the filter that is actually applied", () => {
    render(<InvestmentIntentWorkspace intents={intents} canManage />);
    let dialog = openFilter();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Qualified/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    dialog = openFilter();
    expect(within(dialog).getByRole("button", { name: /^Qualified/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("filters the list on Apply and returns to All on Clear", () => {
    render(<InvestmentIntentWorkspace intents={intents} canManage />);
    expect(tableRows()).toHaveLength(4);

    const dialog = openFilter();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Qualified/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    expect(tableRows()).toHaveLength(2);
    expect(tableRows().join(" ")).toContain("Beaconltd");
    expect(tableRows().join(" ")).not.toContain("Acmecorp");

    openFilter();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Filter investment intent" })).getByRole("button", { name: "Clear" }));

    expect(tableRows()).toHaveLength(4);
  });

  it("keeps the cart axis independent of the status filter", () => {
    render(<InvestmentIntentWorkspace intents={intents} canManage />);
    const dialog = openFilter();

    fireEvent.click(within(dialog).getByRole("button", { name: /^In cart/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    expect(tableRows()).toHaveLength(2);
    expect(tableRows().join(" ")).toContain("Acmecorp");
    expect(tableRows().join(" ")).not.toContain("Cedargroup");
  });

  it("abandons an unapplied draft when the sheet is reopened", () => {
    render(<InvestmentIntentWorkspace intents={intents} canManage />);
    let dialog = openFilter();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Closed/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close filters" }));

    expect(tableRows()).toHaveLength(4);

    dialog = openFilter();
    expect(within(dialog).getByRole("button", { name: /^All/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(dialog).getByRole("button", { name: /^Closed/ }).getAttribute("aria-pressed")).toBe("false");
  });
});
