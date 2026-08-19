/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CartItem } from "../domain/client-portal/cart";

/**
 * What the client is told, and what the cart does when they act on it.
 *
 * The disclosure is the whole reason this feature is not surveillance: adding an
 * investment tells the client's Wolf Forge team they are interested, and the
 * cart says so plainly in both of its states without a consent modal.
 */

const recordStoreInterestAction = vi.fn();

vi.mock("../app/actions/store-interest", () => ({
  recordStoreInterestAction: (input: unknown) => recordStoreInterestAction(input),
}));

const { ClientCartPanel } = await import("../components/account/cart/client-cart-panel");
const { ServiceChooserProvider } = await import(
  "../components/account/services/service-chooser-context"
);
const { addItem, resetCartForTests } = await import("../components/account/cart/cart-store");

function item(overrides: Partial<CartItem> & { id: string }): CartItem {
  return {
    name: "Local SEO",
    priceLabel: "$500",
    amount: 500,
    currency: "USD",
    recurring: false,
    cadence: "one-time",
    categoryName: "Search",
    summary: "A summary.",
    ...overrides,
  };
}

function renderCart() {
  return render(
    <ServiceChooserProvider catalog={{ folders: [], services: [] }} available={true}>
      <ClientCartPanel />
    </ServiceChooserProvider>,
  );
}

function openCart() {
  fireEvent.click(screen.getByRole("button", { name: /Your cart/u }));
}

beforeEach(() => {
  resetCartForTests();
  recordStoreInterestAction.mockReset();
  recordStoreInterestAction.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  resetCartForTests();
});

describe("client cart disclosure", () => {
  it("discloses the signal before anything has been added", () => {
    renderCart();
    openCart();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/lets your Wolf Forge team know you are interested/u);
    // The existing promise is preserved, not replaced.
    expect(dialog).toHaveTextContent(/Nothing is ordered or charged/u);
  });

  it("discloses the signal alongside the selected investments", () => {
    renderCart();
    addItem(item({ id: "service-1" }));
    openCart();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/Nothing is ordered or charged/u);
    expect(dialog).toHaveTextContent(/lets your Wolf Forge team know you are interested/u);
  });

  it("never implies an order or a charge", () => {
    renderCart();
    addItem(item({ id: "service-1" }));
    openCart();

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).not.toMatch(/checkout|buy now|place order|pay now/iu);
  });

  it("records the removal when the client drops an investment from the cart", async () => {
    renderCart();
    addItem(item({ id: "service-1" }));
    openCart();
    recordStoreInterestAction.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Remove Local SEO from your cart/u }));

    // The row plays a short exit before the store drops it.
    await vi.waitFor(() =>
      expect(recordStoreInterestAction).toHaveBeenCalledWith({
        serviceIds: ["service-1"],
        inCart: false,
      }),
    );
  });

  it("keeps the cart intact when the interest signal fails", async () => {
    recordStoreInterestAction.mockRejectedValue(new Error("network down"));

    renderCart();
    addItem(item({ id: "service-1" }));
    openCart();

    await Promise.resolve();
    await Promise.resolve();

    // The investment the client selected is still theirs, and nothing claims otherwise.
    expect(screen.getByRole("dialog")).toHaveTextContent("Local SEO");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
