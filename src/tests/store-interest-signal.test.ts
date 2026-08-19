/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CartItem } from "../domain/client-portal/cart";

/**
 * The cart's sales signal.
 *
 * The contract under test is deliberately lopsided: the local cart is the
 * client's and must always win, while the server signal is best effort. So each
 * test checks two things -- that the right call was made, and that the cart is
 * untouched when that call goes wrong.
 */

const recordStoreInterestAction = vi.fn();

vi.mock("../app/actions/store-interest", () => ({
  recordStoreInterestAction: (input: unknown) => recordStoreInterestAction(input),
}));

const { addItem, clearCart, removeItem, resetCartForTests } = await import(
  "../components/account/cart/cart-store"
);

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

/** The store only emits to subscribers, so the tests subscribe like a component. */
function readCart(): CartItem[] {
  return JSON.parse(window.localStorage.getItem("wf-portal-cart") ?? "[]") as CartItem[];
}

beforeEach(() => {
  resetCartForTests();
  recordStoreInterestAction.mockReset();
  recordStoreInterestAction.mockResolvedValue({ ok: true });
});

afterEach(() => {
  resetCartForTests();
});

describe("cart interest signalling", () => {
  it("reports an add as interest, with service ids and no company", () => {
    addItem(item({ id: "service-1" }));

    expect(recordStoreInterestAction).toHaveBeenCalledTimes(1);
    expect(recordStoreInterestAction).toHaveBeenCalledWith({
      serviceIds: ["service-1"],
      inCart: true,
    });

    // There is no company field for the browser to supply, by construction.
    const [call] = recordStoreInterestAction.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(call).sort()).toEqual(["inCart", "serviceIds"]);
  });

  it("does not re-signal when the same investment is added twice", () => {
    addItem(item({ id: "service-1" }));
    addItem(item({ id: "service-1" }));

    expect(recordStoreInterestAction).toHaveBeenCalledTimes(1);
    expect(readCart()).toHaveLength(1);
  });

  it("signals a different investment as its own new signal", () => {
    addItem(item({ id: "service-1" }));
    addItem(item({ id: "service-2", name: "Press Releases" }));

    expect(recordStoreInterestAction).toHaveBeenCalledTimes(2);
    expect(recordStoreInterestAction).toHaveBeenLastCalledWith({
      serviceIds: ["service-2"],
      inCart: true,
    });
  });

  it("reports a removal without deleting anything the client can see", () => {
    addItem(item({ id: "service-1" }));
    recordStoreInterestAction.mockClear();

    removeItem("service-1");

    expect(recordStoreInterestAction).toHaveBeenCalledWith({
      serviceIds: ["service-1"],
      inCart: false,
    });
    expect(readCart()).toHaveLength(0);
  });

  it("does not signal a removal of something that was never in the cart", () => {
    removeItem("service-unknown");
    expect(recordStoreInterestAction).not.toHaveBeenCalled();
  });

  it("clears the whole cart in a single call rather than one per row", () => {
    addItem(item({ id: "service-1" }));
    addItem(item({ id: "service-2" }));
    addItem(item({ id: "service-3" }));
    recordStoreInterestAction.mockClear();

    clearCart();

    expect(recordStoreInterestAction).toHaveBeenCalledTimes(1);
    expect(recordStoreInterestAction).toHaveBeenCalledWith({
      serviceIds: ["service-1", "service-2", "service-3"],
      inCart: false,
    });
    expect(readCart()).toHaveLength(0);
  });

  it("re-adding after a removal signals renewed interest", () => {
    addItem(item({ id: "service-1" }));
    removeItem("service-1");
    recordStoreInterestAction.mockClear();

    addItem(item({ id: "service-1" }));

    expect(recordStoreInterestAction).toHaveBeenCalledWith({
      serviceIds: ["service-1"],
      inCart: true,
    });
    expect(readCart()).toHaveLength(1);
  });
});

describe("cart survival when tracking fails", () => {
  it("keeps the added investment when the server rejects the signal", async () => {
    recordStoreInterestAction.mockRejectedValue(new Error("network down"));

    expect(() => addItem(item({ id: "service-1" }))).not.toThrow();

    // Let the rejected promise settle; an unhandled rejection would fail the run.
    await Promise.resolve();
    await Promise.resolve();

    expect(readCart()).toHaveLength(1);
    expect(readCart()[0]?.id).toBe("service-1");
  });

  it("keeps the cart emptied when a clear cannot be reported", async () => {
    addItem(item({ id: "service-1" }));
    recordStoreInterestAction.mockRejectedValue(new Error("network down"));

    expect(() => clearCart()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(readCart()).toHaveLength(0);
  });

  it("does not block the cart on a slow signal", () => {
    // A pending promise that never settles: the cart must already be updated.
    recordStoreInterestAction.mockReturnValue(new Promise(() => {}));

    addItem(item({ id: "service-1" }));

    expect(readCart()).toHaveLength(1);
  });
});
