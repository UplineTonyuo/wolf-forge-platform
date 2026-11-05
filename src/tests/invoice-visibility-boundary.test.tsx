// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinancialVisibilityBoundary } from "../components/invoices/financial-visibility-boundary";

import { invoiceVisibility, storeVisibility } from "../domain/invoices/visibility";

const original = invoiceVisibility([], true);
const mocks = vi.hoisted(() => ({ load: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../app/actions/financial-visibility", () => ({ loadFinancialVisibilityAction: mocks.load }));
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  mocks.load.mockResolvedValue({ ok: true, signature: original });
});
afterEach(cleanup);
const mount = () => render(<FinancialVisibilityBoundary scope="client" signature={original}><p>Protected receipt</p></FinancialVisibilityBoundary>);
it("clears loaded financial content when current authorization is denied", async () => {
  mocks.load.mockResolvedValue({ ok: false, denied: true });
  mount();
  await screen.findByRole("alert");
  expect(screen.queryByText("Protected receipt")).toBeNull();
  expect(mocks.refresh).toHaveBeenCalled();
});

it('binds internal company history refresh to its company and redacts on current denial', async () => {
  mocks.load.mockResolvedValue({ ok: false, denied: true });
  render(<FinancialVisibilityBoundary scope="internal" companyId="selected" signature={original}><p>Selected company invoices</p></FinancialVisibilityBoundary>);
  await screen.findByRole('alert');
  expect(mocks.load).toHaveBeenCalledWith('internal', undefined, 'selected');
  expect(screen.queryByText('Selected company invoices')).toBeNull();
});
it("clears stale new-work controls and refreshes after publication changes", async () => {
  mount();
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
  mocks.load.mockResolvedValue({ ok: true, signature: invoiceVisibility([], false) });
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(screen.queryByText("Protected receipt")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("updating");
});
it("preserves authorized history after a retryable infrastructure failure", async () => {
  mocks.load.mockResolvedValue({ ok: false, denied: false });
  mount();
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
  expect(screen.getByText("Protected receipt")).toBeTruthy();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("preserves authorized history after an action transport failure", async () => {
  mocks.load.mockRejectedValue(new Error("Transport unavailable"));
  mount();
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
  expect(screen.getByText("Protected receipt")).toBeTruthy();
});
it("ignores a delayed denial from the previous financial scope", async () => {
  let resolveOld!: (result: { ok: false; denied: true }) => void;
  mocks.load.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
  const view = mount();
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
  mocks.load.mockResolvedValue({ ok: true, signature: JSON.stringify([0, "USD", [], true, "active"]) });
  view.rerender(<FinancialVisibilityBoundary key="wallet" scope="wallet" signature={JSON.stringify([0, "USD", [], true, "active"])}><p>Current wallet history</p></FinancialVisibilityBoundary>);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  await act(async () => resolveOld({ ok: false, denied: true }));
  expect(screen.getByText("Current wallet history")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("refreshes changed money without unmounting an accepted result", async () => {
  const before = storeVisibility({ balance_cents: 1000, currency: "USD" }, true, true);
  const after = storeVisibility({ balance_cents: 0, currency: "USD" }, true, true);
  mocks.load.mockResolvedValue({ ok: true, signature: before });
  const view = render(<FinancialVisibilityBoundary scope="store" signature={before}><p>Accepted purchase</p></FinancialVisibilityBoundary>);
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
  mocks.load.mockResolvedValue({ ok: true, signature: after });
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(screen.getByText("Accepted purchase")).toBeTruthy();
  expect(mocks.refresh).toHaveBeenCalled();
  view.rerender(<FinancialVisibilityBoundary scope="store" signature={after}><p>Accepted purchase</p></FinancialVisibilityBoundary>);
  expect(screen.getByText("Accepted purchase")).toBeTruthy();
});
it("redacts a removed record while allowing added records to refresh", async () => {
  const row = (id: string) => ({ invoice: { id, updated_at: "now", status: "paid" }, financials: {} }) as Parameters<typeof invoiceVisibility>[0][number];
  const before = invoiceVisibility([row("receipt")], true);
  mocks.load.mockResolvedValue({ ok: true, signature: before });
  render(<FinancialVisibilityBoundary scope="client" signature={before}><p>Protected receipt</p></FinancialVisibilityBoundary>);
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
  mocks.load.mockResolvedValue({ ok: true, signature: invoiceVisibility([row("receipt"), row("added")], true) });
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(screen.getByText("Protected receipt")).toBeTruthy();
  mocks.load.mockResolvedValue({ ok: true, signature: invoiceVisibility([row("added")], true) });
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(screen.queryByText("Protected receipt")).toBeNull();
});
