import { describe, expect, it } from "vitest";
import {
  addToCart,
  cartCtaLabel,
  cartLimit,
  cadenceShortLabels,
  cartDraftBody,
  cartDraftSubject,
  cartTotals,
  parseCart,
  removeFromCart,
  type CartItem,
} from "../domain/client-portal/cart";
import { summarizeServiceDescription } from "../domain/services/service-summary";
import { isFranchiseInABoxService, storeContactLabel } from "../domain/services/store-projections";

/**
 * The captured catalogue comes in two shapes, and both used to reach the card
 * as the raw first 190 characters. These cases are lifted from the real
 * migrations so the heuristics are pinned to the data they were written for.
 */
describe("store preview summaries", () => {
  it("leads with prose and drops the ornamental headings above it", () => {
    const summary = summarizeServiceDescription(
      "<h2>🐺 MAPS OPTIMIZATION SYSTEM</h2>" +
        "<div>🚨 WE FOUND THE PROBLEMS. NOW LET US FIX THEM.</div>" +
        "<div>Your Google Business Profile might be costing you customers without you even realizing it.</div>" +
        "<div>WE'LL FIX THE FOUNDATION:</div>" +
        "<div>✓ Google Business Profile optimization<br>✓ Photo optimization</div>",
    );

    expect(summary).toBe(
      "Your Google Business Profile might be costing you customers without you even realizing it.",
    );
  });

  it("summarises an inclusion-only description instead of reprinting the list", () => {
    const summary = summarizeServiceDescription(
      "<div>✅ 100 Citations</div><div>✅ 1 Branded Press Release</div>" +
        "<div>✅ 1 Blog per month</div><div>✅ 1 Youtube Stack</div><div>✅ 1 Podcast</div>",
    );

    expect(summary).toBe(
      "Includes 100 Citations, 1 Branded Press Release and 1 Blog per month, plus 2 more inclusions.",
    );
  });

  it("does not present a run of title-case labels as a sentence", () => {
    // Real capture: a trailing block of entity names with no connectives.
    const summary = summarizeServiceDescription(
      "<div>Core Google Entities Social Media Entities Web 2.0 / Supporting Entities</div>" +
        "<div>✅ 20 Targeted Keywords</div>",
    );

    expect(summary).toBe("Includes 20 Targeted Keywords.");
  });

  it("keeps buyer requirements out of the inclusion list", () => {
    const summary = summarizeServiceDescription(
      "<div>✅ You must submit a 500 word article.</div><div>✅ 150 News Sites</div>",
    );

    expect(summary).toBe("Includes 150 News Sites.");
  });

  it("returns nothing rather than a fragment when there is nothing usable", () => {
    expect(summarizeServiceDescription("<div>WHAT'S INCLUDED:</div>")).toBe("");
    expect(summarizeServiceDescription(null)).toBe("");
    expect(summarizeServiceDescription("")).toBe("");
  });
});

describe("the Franchise in a Box contact rule", () => {
  it("names William only for that engagement", () => {
    expect(storeContactLabel("Franchise in a Box System")).toBe("Talk to William");
    expect(storeContactLabel("franchise in a box")).toBe("Talk to William");
    expect(storeContactLabel("Starter SEO")).toBe("Talk to your team");
    expect(storeContactLabel("Franchise Marketing Audit")).toBe("Talk to your team");
  });

  it("matches the service by its captured name", () => {
    expect(isFranchiseInABoxService("Franchise in a Box System")).toBe(true);
    expect(isFranchiseInABoxService("Local SEO")).toBe(false);
  });
});

describe("the request cart", () => {
  const item = (
    id: string,
    name = id,
    overrides: Partial<CartItem> = {},
  ): CartItem => ({
    id,
    name,
    priceLabel: "$297",
    amount: 297,
    currency: "USD",
    recurring: false,
    cadence: "one-time",
    categoryName: "Local SEO",
    summary: "A short preview line.",
    ...overrides,
  });

  it("holds each investment once", () => {
    const withOne = addToCart([], item("a"));
    expect(addToCart(withOne, item("a"))).toBe(withOne);
    expect(addToCart(withOne, item("b"))).toHaveLength(2);
  });

  it("refuses to grow past the limit", () => {
    const full = Array.from({ length: cartLimit }, (_, index) => item(`s${index}`));
    expect(addToCart(full, item("extra"))).toBe(full);
  });

  it("removes by id", () => {
    expect(removeFromCart([item("a"), item("b")], "a").map((entry) => entry.id)).toEqual(["b"]);
  });

  it("names William only when every selected investment is his engagement", () => {
    expect(cartCtaLabel([item("a", "Franchise in a Box System")])).toBe("Talk to William");

    // A mixed cart stays neutral: routing everything at one person would
    // misdescribe who picks the conversation up.
    expect(cartCtaLabel([item("a", "Starter SEO"), item("b", "Franchise in a Box System")])).toBe(
      "Discuss these investments",
    );
    expect(cartCtaLabel([item("a", "Starter SEO")])).toBe("Discuss these investments");
    expect(cartCtaLabel([])).toBe("Discuss these investments");
  });

  it("keeps one-time, monthly and annual money in separate totals", () => {
    const totals = cartTotals([
      item("a", "Audit", { amount: 97, cadence: "one-time" }),
      item("b", "Care", { amount: 97, cadence: "one-time" }),
      item("c", "Local SEO", { amount: 500, cadence: "monthly", recurring: true }),
      item("d", "Retainer", { amount: 1200, cadence: "annual", recurring: true }),
    ]);

    expect(totals.map((total) => [total.label, total.formatted, total.count])).toEqual([
      ["One-time", "$194", 2],
      ["Monthly recurring", "$500 / month", 1],
      ["Annual recurring", "$1,200 / year", 1],
    ]);

    // Nothing anywhere adds them together.
    expect(totals.some((total) => total.amount === 1894)).toBe(false);
  });

  it("groups totals per currency so two currencies never merge", () => {
    const totals = cartTotals([
      item("a", "A", { amount: 100, currency: "USD" }),
      item("b", "B", { amount: 100, currency: "EUR" }),
    ]);

    expect(totals).toHaveLength(2);
    expect(totals.map((total) => total.currency).sort()).toEqual(["EUR", "USD"]);
  });

  it("fills fields added after a cart was already stored", () => {
    // A cart persisted before cadence/summary existed must still open.
    const legacy = JSON.stringify([
      { id: "a", name: "Local SEO", priceLabel: "$500", recurring: true, categoryName: null },
    ]);

    const [restored] = parseCart(legacy);
    expect(restored?.cadence).toBe("monthly");
    expect(restored?.currency).toBe("USD");
    expect(restored?.summary).toBe("");
    expect(restored?.amount).toBe(0);
  });

  it("drops anything malformed coming back out of storage", () => {
    expect(parseCart(null)).toEqual([]);
    expect(parseCart("not json")).toEqual([]);
    expect(parseCart('{"id":"a"}')).toEqual([]);
    expect(parseCart('[{"id":"a"},{"nope":1}]')).toEqual([]);

    const good = JSON.stringify([item("a", "Starter SEO")]);
    expect(parseCart(good).map((entry) => entry.name)).toEqual(["Starter SEO"]);
    expect(parseCart(good)[0]?.cadence).toBe("one-time");
  });

  it("hands the composer the selection instead of dropping it", () => {
    const items = [
      item("a", "Local SEO", { priceLabel: "$500 / month", categoryName: "Local SEO" }),
      item("b", "GMB Optimization", { priceLabel: "$297", categoryName: "GBP Only SEO" }),
    ];

    expect(cartDraftSubject(items)).toBe("About 2 investments");
    expect(cartDraftSubject([items[0]!])).toBe("About Local SEO");

    const body = cartDraftBody(items);
    // Every selected investment reaches the draft, with the price the cart showed.
    expect(body).toContain("- Local SEO (Local SEO) — $500 / month");
    expect(body).toContain("- GMB Optimization (GBP Only SEO) — $297");
    // Nothing is committed to or priced differently in the handoff.
    expect(body).not.toMatch(/total|order|pay|invoice/i);

    expect(cartDraftSubject([])).toBe("");
    expect(cartDraftBody([])).toBe("");
  });

  it("labels a row with the same cadence vocabulary as its total", () => {
    // A row reading "Recurring" against "Monthly recurring" / "Annual recurring"
    // totals left the client unable to tell which bucket their item was in.
    const monthly = item("a", "Local SEO", { cadence: "monthly", recurring: true });
    const annual = item("b", "Retainer", { cadence: "annual", recurring: true });

    expect(cadenceShortLabels[monthly.cadence]).toBe("Monthly");
    expect(cadenceShortLabels[annual.cadence]).toBe("Annual");
    expect(cadenceShortLabels[item("c").cadence]).toBe("One-time");

    const totals = cartTotals([monthly, annual]);
    for (const total of totals) {
      expect(total.label.startsWith(cadenceShortLabels[total.cadence])).toBe(true);
    }
  });

  it("caps the clear-out stagger so a full cart never becomes a wait", async () => {
    // Mirrors clearStaggerFor in client-cart-panel.tsx: 30ms per row, capped.
    const clearStaggerFor = (index: number) => Math.min(index * 30, 180);

    expect(clearStaggerFor(0)).toBe(0);
    expect(clearStaggerFor(2)).toBe(60);
    // A full cart still finishes on the cap, not 12 x 30ms.
    expect(clearStaggerFor(cartLimit - 1)).toBe(180);

    const longestExit = clearStaggerFor(cartLimit - 1) + 200;
    expect(longestExit).toBeLessThanOrEqual(400);
  });

  it("caps a tampered oversized cart at the limit", () => {
    const oversized = JSON.stringify(
      Array.from({ length: cartLimit + 8 }, (_, index) => item(`s${index}`)),
    );
    expect(parseCart(oversized)).toHaveLength(cartLimit);
  });
});
