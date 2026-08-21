/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CartItem } from "../domain/client-portal/cart";

/**
 * The header cart: one icon, a real item count, and a transient arrival beat.
 *
 * These assertions are made against the rendered header rather than a hook,
 * because the things that went wrong last time were all about the DOM — how many
 * cart elements exist, whether the icon is replaced, and what the badge shows.
 */

vi.mock("../app/actions/store-interest", () => ({
  recordStoreInterestAction: vi.fn(async () => ({ ok: true })),
}));

const { ClientCartPanel } = await import("../components/account/cart/client-cart-panel");
const { ServiceChooserProvider } = await import(
  "../components/account/services/service-chooser-context"
);
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

function renderHeader() {
  return render(
    <ServiceChooserProvider catalog={{ folders: [], services: [] }} available={true}>
      <ClientCartPanel />
    </ServiceChooserProvider>,
  );
}

/**
 * The single cart trigger button in the header.
 *
 * Selected by its header class rather than by role+name: once the dialog is
 * open its own controls also answer to /your cart/i, and this must always mean
 * the header trigger.
 */
function triggers(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("button.portal-command-button")];
}

function trigger(): HTMLElement {
  const found = triggers();
  if (found.length !== 1) throw new Error(`expected one cart trigger, found ${found.length}`);
  return found[0]!;
}

/** The one cart icon inside it — the element the animation must play on. */
function icon(): SVGElement {
  const found = trigger().querySelector("svg");
  if (!found) throw new Error("cart icon missing");
  return found;
}

/** The visible item-count badge, or null when the cart is empty. */
function badgeText(): string | null {
  return trigger().querySelector("em")?.textContent ?? null;
}

function bump(): string | null {
  return icon().getAttribute("data-bump");
}

beforeEach(() => {
  resetCartForTests();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  resetCartForTests();
});

describe("header cart structure", () => {
  it("renders exactly one cart trigger and one cart icon", () => {
    renderHeader();

    expect(triggers()).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /your cart/i })).toHaveLength(1);
    expect(trigger().querySelectorAll("svg")).toHaveLength(1);
  });

  it("still renders exactly one cart after several adds", () => {
    renderHeader();

    act(() => addItem(item({ id: "service-1" })));
    act(() => addItem(item({ id: "service-2" })));
    act(() => addItem(item({ id: "service-3" })));

    expect(triggers()).toHaveLength(1);
    expect(trigger().querySelectorAll("svg")).toHaveLength(1);
  });

  it("shows no badge for an empty cart", () => {
    renderHeader();
    expect(badgeText()).toBeNull();
  });

  it("shows the number of investments in the cart, and nothing else", () => {
    renderHeader();

    act(() => addItem(item({ id: "service-1" })));
    expect(badgeText()).toBe("1");

    act(() => addItem(item({ id: "service-2" })));
    expect(badgeText()).toBe("2");

    act(() => addItem(item({ id: "service-3" })));
    act(() => addItem(item({ id: "service-4" })));
    act(() => addItem(item({ id: "service-5" })));
    act(() => addItem(item({ id: "service-6" })));
    expect(badgeText()).toBe("6");
  });

  it("counts down again as investments are removed", () => {
    renderHeader();

    act(() => addItem(item({ id: "service-1" })));
    act(() => addItem(item({ id: "service-2" })));
    act(() => removeItem("service-1"));

    expect(badgeText()).toBe("1");

    act(() => clearCart());
    expect(badgeText()).toBeNull();
  });

  it("never renders a value that is not the item count", () => {
    renderHeader();

    // Six adds and two removals: an event counter would read 6, the cart holds 4.
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      act(() => addItem(item({ id })));
    }
    act(() => removeItem("a"));
    act(() => removeItem("b"));

    expect(badgeText()).toBe("4");
    expect(trigger().textContent).toBe("4");
  });
});

describe("header cart arrival animation", () => {
  it("is at rest before anything is added", () => {
    renderHeader();
    expect(bump()).toBeNull();
  });

  it("animates the same icon element on each genuine add", () => {
    renderHeader();
    const first = icon();

    act(() => addItem(item({ id: "service-1" })));
    const afterFirst = bump();
    expect(afterFirst).not.toBeNull();

    act(() => addItem(item({ id: "service-2" })));
    const afterSecond = bump();
    expect(afterSecond).not.toBeNull();

    // Restarted rather than re-applied, so a rapid second add is still felt.
    expect(afterSecond).not.toBe(afterFirst);

    act(() => addItem(item({ id: "service-3" })));
    expect(bump()).not.toBe(afterSecond);

    // The crux: the icon was animated in place, never replaced.
    expect(icon()).toBe(first);
  });

  it("does not animate when an investment is already in the cart", () => {
    renderHeader();

    act(() => addItem(item({ id: "service-1" })));
    const afterAdd = bump();

    act(() => addItem(item({ id: "service-1" })));
    expect(bump()).toBe(afterAdd);
    expect(badgeText()).toBe("1");
  });

  it("does not animate on removal or clear", () => {
    renderHeader();

    act(() => addItem(item({ id: "service-1" })));
    act(() => addItem(item({ id: "service-2" })));
    const afterAdds = bump();

    act(() => removeItem("service-1"));
    expect(bump()).toBe(afterAdds);

    act(() => clearCart());
    expect(bump()).toBe(afterAdds);
  });

  it("does not animate when a stored cart is restored on load", () => {
    window.localStorage.setItem(
      "wf-portal-cart",
      JSON.stringify([item({ id: "service-restored" }), item({ id: "service-restored-2" })]),
    );

    renderHeader();

    expect(bump()).toBeNull();
    // The restored contents still count, which is the point of the separation.
    expect(badgeText()).toBe("2");
  });

  it("does not animate when another tab syncs the cart", () => {
    renderHeader();

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "wf-portal-cart",
          newValue: JSON.stringify([item({ id: "service-from-other-tab" })]),
        }),
      );
    });

    expect(bump()).toBeNull();
    expect(badgeText()).toBe("1");
  });

  it("does not animate on an ordinary re-render", () => {
    const { rerender } = renderHeader();

    act(() => addItem(item({ id: "service-1" })));
    const afterAdd = bump();

    rerender(
      <ServiceChooserProvider catalog={{ folders: [], services: [] }} available={true}>
        <ClientCartPanel />
      </ServiceChooserProvider>,
    );
    rerender(
      <ServiceChooserProvider catalog={{ folders: [], services: [] }} available={true}>
        <ClientCartPanel />
      </ServiceChooserProvider>,
    );

    expect(bump()).toBe(afterAdd);
  });

  it("does not animate when the cart is opened", () => {
    renderHeader();

    act(() => addItem(item({ id: "service-1" })));
    const afterAdd = bump();

    act(() => trigger().click());

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(bump()).toBe(afterAdd);
  });
});
