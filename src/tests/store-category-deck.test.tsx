/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { StoreCatalogView } from "../components/account/store/store-catalog";
import type { StoreCatalog, StoreFolderView, StoreServiceView } from "../domain/services/store-projections";
import { resetCartForTests } from "../components/account/cart/cart-store";

/**
 * The client Store Investment Category Deck.
 *
 * The category rail used to scroll horizontally, so real categories (On-page
 * SEO, Technical SEO, Website Design, Press Releases, Backlink Service) were
 * only reachable by a hidden scroll. This suite proves the deck makes every
 * real category reachable, keeps the counts honest, composes with search, and
 * stays keyboard-accessible with a real expanded/collapsed state.
 */

const recordStoreInterestAction = vi.fn();

vi.mock("../app/actions/store-interest", () => ({
  recordStoreInterestAction: (input: unknown) => recordStoreInterestAction(input),
}));

// next/link is satisfied by a plain anchor; the deck tests care about the
// category controls, not routing.
vi.mock("next/link", () => ({
  default: (props: { href: string; children?: ReactNode; [key: string]: unknown }) => (
    <a {...props} />
  ),
}));

function makeService(
  name: string,
  folderId: string | null,
  amount = 297,
  extra: Partial<StoreServiceView> = {},
): StoreServiceView {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    folderId,
    priceLabel: `$${amount}`,
    amount,
    currency: "USD",
    recurring: false,
    cadence: "one-time",
    recurringLabel: null,
    imageUrl: null,
    descriptionHtml: "",
    summary: `${name} summary line.`,
    ...extra,
  };
}

/** The real captured folder names, with per-folder services that mirror the catalogue shape. */
function buildCatalog(): StoreCatalog {
  const folder = (
    id: string,
    name: string,
    description: string | null,
    services: StoreServiceView[],
  ): StoreFolderView => ({ id, name, description, services });

  const folders: StoreFolderView[] = [
    folder("folder-gbp", "GBP Only SEO", "Google Business Profile work", [
      makeService("Google Business Profile Optimization", "folder-gbp", 500),
      makeService("GMB Rank Tracker", "folder-gbp", 250),
    ]),
    folder("folder-local", "Local SEO", "Rank in your city", [
      makeService("Local SEO Starter", "folder-local", 297),
      makeService("Local SEO Growth", "folder-local", 500),
      makeService("Local SEO Scale", "folder-local", 900),
      makeService("City Pages Pro", "folder-local", 1200),
    ]),
    folder("folder-ecommerce", "Ecommerce SEO", null, [
      makeService("Ecommerce Audit", "folder-ecommerce", 297),
      makeService("Product Page Optimization", "folder-ecommerce", 497),
      makeService("Category Page SEO", "folder-ecommerce", 497),
    ]),
    folder("folder-onpage", "Onpage & Technical SEO", null, [
      makeService("On-page SEO", "folder-onpage", 400),
      makeService("Technical SEO Fixes", "folder-onpage", 600),
      makeService("Core Web Vitals", "folder-onpage", 450),
      makeService("Site Architecture", "folder-onpage", 350),
      makeService("Schema Markup", "folder-onpage", 300),
    ]),
    folder("folder-website", "Website Design", null, [
      makeService("Starter Website", "folder-website", 1500),
      makeService("Business Website", "folder-website", 2500),
      makeService("Web Design WooCommerce", "folder-website", 3000),
      makeService("Landing Page", "folder-website", 800),
      makeService("Redesign Package", "folder-website", 2000),
      makeService("Website Care Plan", "folder-website", 250, {
        recurring: true,
        cadence: "monthly",
        recurringLabel: "$250 / month",
      }),
    ]),
    folder("folder-press", "Press Releases", null, [
      makeService("Basic Press Release Distribution", "folder-press", 297),
      makeService("Standard Press Release Distribution", "folder-press", 597),
      makeService("Premium Press Release Distribution", "folder-press", 997),
      makeService("Yahoo Press Release Distribution", "folder-press", 1497),
      makeService("Business Insider Press Release", "folder-press", 5000),
    ]),
    folder("folder-backlinks", "Backlink Service", null, [
      makeService("Starter Backlink SEO Package", "folder-backlinks", 297),
      makeService("Basic SEO Backlink Package", "folder-backlinks", 497),
      makeService("50 Branded Foundation Authority Backlinks", "folder-backlinks", 697),
      makeService("140 EDU Backlinks", "folder-backlinks", 897),
      makeService("Press Release Stack", "folder-backlinks", 497),
      makeService("Guest Post Links", "folder-backlinks", 399),
      makeService("Blogger Outreach Links", "folder-backlinks", 299),
      makeService("Authority Link Building", "folder-backlinks", 999),
    ]),
  ];

  const ungrouped = [makeService("Standalone Audit", null, 200)];

  return {
    folders,
    ungrouped,
    serviceCount: folders.reduce((total, entry) => total + entry.services.length, 0) + ungrouped.length,
  };
}

const catalog = buildCatalog();
// vitest runs with the repository root as cwd; the css module is read straight
// from source because jsdom applies no stylesheets to verify against.
const cssSource = readFileSync(
  resolve(process.cwd(), "src/components/account/store/store-catalog.module.css"),
  "utf8",
);

function renderCatalog() {
  return render(<StoreCatalogView catalog={catalog} />);
}

/** The single control that opens and closes the deck, by whichever label it wears. */
function deckToggle() {
  return screen.getByRole("button", { name: /Close categories|Change category|Explore all categories/ });
}

function openDeck() {
  fireEvent.click(deckToggle());
}

function deckList() {
  return screen.getByRole("list", { name: "Store categories" });
}

beforeEach(() => {
  resetCartForTests();
  recordStoreInterestAction.mockReset();
  recordStoreInterestAction.mockResolvedValue({ ok: true });
  window.history.replaceState({}, "", "/account/store");
});

afterEach(() => {
  cleanup();
  resetCartForTests();
});

describe("investment category deck", () => {
  it("renders every real category as a reachable tile once the deck is open", () => {
    renderCatalog();
    openDeck();

    const grid = deckList();
    // The real folders plus the selectable All and the ungrouped bucket.
    expect(within(grid).getAllByRole("button")).toHaveLength(9);

    for (const name of [
      "All investments",
      "GBP Only SEO",
      "Local SEO",
      "Ecommerce SEO",
      "Onpage & Technical SEO",
      "Website Design",
      "Press Releases",
      "Backlink Service",
      "Other investments",
    ]) {
      expect(within(grid).getByRole("button", { name: new RegExp(name) })).toBeInTheDocument();
    }

    // Keyboard reachable once open: focus lands on a tile.
    within(grid).getByRole("button", { name: /Press Releases/ }).focus();
    expect(within(grid).getByRole("button", { name: /Press Releases/ })).toHaveFocus();
  });

  it("replaces the horizontal pill rail with a wrapping grid, not a scroll rail", () => {
    renderCatalog();

    // The old scrollable group of category pills is gone from the page.
    expect(screen.queryByRole("group", { name: "Service categories" })).not.toBeInTheDocument();

    // The deck is a responsive auto-fill grid in the source, and the old rail
    // (and its overflow-x) is gone — nothing about categories scrolls sideways.
    expect(cssSource).toContain("grid-template-columns: repeat(auto-fill, minmax");
    expect(cssSource).not.toContain(".pills");
  });

  it("shows real counts on the tiles and in the compact state", () => {
    renderCatalog();
    openDeck();

    expect(screen.getByRole("button", { name: /All investments/ })).toHaveTextContent("34 investments");
    expect(screen.getByRole("button", { name: /Backlink Service/ })).toHaveTextContent("8 investments");
    expect(screen.getByRole("button", { name: /GBP Only SEO/ })).toHaveTextContent("2 investments");

    // The compact state repeats the real total while nothing is selected.
    expect(screen.getByLabelText("All investments, 34 investments")).toBeInTheDocument();
  });

  it("selecting a category filters the grid and hides the spotlight", () => {
    renderCatalog();
    openDeck();
    fireEvent.click(within(deckList()).getByRole("button", { name: /Press Releases/ }));

    expect(screen.getByRole("heading", { level: 1, name: "Press Releases" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Premium Press Release Distribution" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Business Insider Press Release" })).toBeInTheDocument();

    // Nothing from another category leaks in.
    expect(screen.queryByRole("heading", { level: 3, name: "Authority Link Building" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "Local SEO Starter" })).not.toBeInTheDocument();

    // The flagship is scoped to the unfiltered view, so it leaves with a category.
    expect(screen.queryByText("Flagship")).not.toBeInTheDocument();
  });

  it("keeps the flagship spotlight on the unfiltered view only", () => {
    renderCatalog();
    // Real top-tier engagement, named straight off the price.
    expect(screen.getByText("Flagship")).toBeInTheDocument();
  });

  it("collapses the deck after selection and makes the content inert again", () => {
    renderCatalog();
    openDeck();
    expect(deckToggle()).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("store-category-deck")?.querySelector("[inert]")).toBeNull();

    fireEvent.click(within(deckList()).getByRole("button", { name: /Backlink Service/ }));

    expect(deckToggle()).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("store-category-deck")?.querySelector("[inert]")).not.toBeNull();
  });

  it("shows the active category with its real count in the compact state", () => {
    renderCatalog();
    openDeck();
    fireEvent.click(within(deckList()).getByRole("button", { name: /Backlink Service/ }));

    expect(screen.getByLabelText("Backlink Service, 8 investments")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Change category/ })).toBeInTheDocument();
  });

  it("reopens to change category", () => {
    renderCatalog();
    openDeck();
    fireEvent.click(within(deckList()).getByRole("button", { name: /Press Releases/ }));

    openDeck();
    fireEvent.click(within(deckList()).getByRole("button", { name: /Backlink Service/ }));

    expect(screen.getByRole("heading", { level: 1, name: "Backlink Service" })).toBeInTheDocument();
    expect(screen.getByLabelText("Backlink Service, 8 investments")).toBeInTheDocument();
    expect(window.location.search).toContain("folder=folder-backlinks");
    expect(deckToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("heading", { level: 3, name: "Authority Link Building" })).toBeInTheDocument();
  });

  it("keeps ?folder= honest as the category changes", () => {
    renderCatalog();
    openDeck();
    fireEvent.click(within(deckList()).getByRole("button", { name: /Press Releases/ }));
    expect(window.location.search).toContain("folder=folder-press");

    openDeck();
    fireEvent.click(within(deckList()).getByRole("button", { name: /All investments/ }));
    expect(window.location.search).not.toContain("folder=");
    expect(screen.getByLabelText("All investments, 34 investments")).toBeInTheDocument();
  });

  it("composes search with the selected category", () => {
    renderCatalog();
    openDeck();
    fireEvent.click(within(deckList()).getByRole("button", { name: /Press Releases/ }));

    fireEvent.change(screen.getByLabelText("Filter investments by name"), {
      target: { value: "premium" },
    });

    expect(screen.getByRole("heading", { level: 3, name: "Premium Press Release Distribution" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "Standard Press Release Distribution" })).not.toBeInTheDocument();
  });

  it("renders no duplicate investment in a filtered category", () => {
    renderCatalog();
    openDeck();
    fireEvent.click(within(deckList()).getByRole("button", { name: /Backlink Service/ }));

    expect(screen.getAllByRole("heading", { level: 3, name: "Starter Backlink SEO Package" })).toHaveLength(1);
    // One section, and every card is a distinct investment.
    expect(screen.getByRole("heading", { level: 2, name: "Backlink Service" })).toBeInTheDocument();
  });

  it("exposes an accessible expanded/collapsed state and closes on Escape", () => {
    renderCatalog();

    const toggle = deckToggle();
    expect(toggle).toHaveAttribute("aria-controls", "store-category-deck");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    openDeck();
    expect(deckToggle()).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(deckToggle()).toHaveAttribute("aria-expanded", "false");
    expect(deckToggle()).toHaveFocus();
  });

  it("keeps a reduced-motion path for the deck", () => {
    // jsdom applies no stylesheets, so the reduced-motion path is verified in
    // the source the component ships: the deck and its tiles are calmed there.
    expect(cssSource).toContain("@media (prefers-reduced-motion: reduce)");
    expect(cssSource).toMatch(/prefers-reduced-motion[\s\S]*\.deckBody/);
    expect(cssSource).toMatch(/prefers-reduced-motion[\s\S]*\.tile/);
    // The tile lift is the restrained -2px the design calls for, not a bounce.
    expect(cssSource).toContain("transform: translateY(-2px)");
  });
});
