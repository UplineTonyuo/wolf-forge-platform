import { describe, expect, it } from "vitest";
import {
  composeClientBalance,
  describeCurrencyBalance,
  invoiceIsCollectible,
  type ClientBalanceInput,
} from "../domain/client-portal/balance";
import {
  connectedOnlinePaymentProviders,
  resolvePaymentMethodState,
  resolveWalletFunding,
  type StoredPaymentMethod,
} from "../domain/client-portal/payment-method";
import { invoiceAttention } from "../domain/client-portal/attention";
import {
  recurringAmountLabel,
  renewalCadence,
} from "../domain/client-portal/subscription-language";

const NOW = new Date("2026-08-18T00:00:00.000Z");

function invoice(
  overrides: Partial<ClientBalanceInput["invoice"]> &
    Partial<ClientBalanceInput["financials"]> = {},
): ClientBalanceInput {
  return {
    invoice: {
      currency: overrides.currency ?? "USD",
      due_at: overrides.due_at ?? null,
    },
    financials: {
      presentation_state: overrides.presentation_state ?? "unpaid",
      balance_due_cents: overrides.balance_due_cents ?? 0,
      is_overdue: overrides.is_overdue ?? false,
    },
  };
}

describe("outstanding balance", () => {
  it("sums only collectible invoices", () => {
    const balance = composeClientBalance(
      [
        invoice({ presentation_state: "unpaid", balance_due_cents: 150_000 }),
        invoice({ presentation_state: "overdue", balance_due_cents: 95_000, is_overdue: true }),
        invoice({ presentation_state: "paid", balance_due_cents: 0 }),
      ],
      NOW,
    );

    expect(balance.currencies).toHaveLength(1);
    expect(balance.currencies[0]?.outstandingCents).toBe(245_000);
    expect(balance.totalCollectibleInvoices).toBe(2);
    expect(balance.totalOverdueInvoices).toBe(1);
  });

  it("excludes void and draft invoices even when the row still carries a balance", () => {
    /*
     * The database only zeroes balance_due_cents for a PAID invoice; a voided
     * one keeps its total. Trusting the number alone would bill the client for
     * an invoice Wolf Forge cancelled.
     */
    const balance = composeClientBalance(
      [
        invoice({ presentation_state: "void", balance_due_cents: 500_000 }),
        invoice({ presentation_state: "draft", balance_due_cents: 300_000 }),
      ],
      NOW,
    );

    expect(balance.currencies).toEqual([]);
    expect(balance.totalCollectibleInvoices).toBe(0);
  });

  it("reflects a partial payment as the remaining balance only", () => {
    // A 1,000.00 invoice with 400.00 settled reports 600.00 due.
    const balance = composeClientBalance(
      [invoice({ presentation_state: "unpaid", balance_due_cents: 60_000 })],
      NOW,
    );

    expect(balance.currencies[0]?.outstandingCents).toBe(60_000);
  });

  it("counts a partially refunded invoice that still owes money", () => {
    const balance = composeClientBalance(
      [invoice({ presentation_state: "partially_refunded", balance_due_cents: 25_000 })],
      NOW,
    );

    expect(balance.currencies[0]?.outstandingCents).toBe(25_000);
  });

  it("treats a fully refunded invoice as settled", () => {
    expect(
      invoiceIsCollectible({ presentation_state: "refunded", balance_due_cents: 40_000 }),
    ).toBe(false);
  });

  it("never adds different currencies together", () => {
    const balance = composeClientBalance(
      [
        invoice({ currency: "USD", balance_due_cents: 100_000 }),
        invoice({ currency: "EUR", balance_due_cents: 250_000 }),
        invoice({ currency: "usd", balance_due_cents: 45_000 }),
      ],
      NOW,
    );

    expect(balance.isMultiCurrency).toBe(true);
    // Largest first, and USD is one bucket regardless of stored casing.
    expect(balance.currencies.map((entry) => [entry.currency, entry.outstandingCents])).toEqual([
      ["EUR", 250_000],
      ["USD", 145_000],
    ]);

    // The whole point: no combined figure exists anywhere on the result.
    expect(balance).not.toHaveProperty("outstandingCents");
    expect(balance).not.toHaveProperty("totalCents");
  });

  it("reports a single currency as not multi-currency", () => {
    const balance = composeClientBalance([invoice({ balance_due_cents: 1_000 })], NOW);
    expect(balance.isMultiCurrency).toBe(false);
  });

  it("returns no currency at all when nothing is owed", () => {
    const balance = composeClientBalance([invoice({ presentation_state: "paid" })], NOW);

    expect(balance.currencies).toEqual([]);
    expect(balance.totalCollectibleInvoices).toBe(0);
  });

  it("counts invoices due within the next week, and never counts an overdue one twice", () => {
    const balance = composeClientBalance(
      [
        invoice({
          balance_due_cents: 10_000,
          due_at: "2026-08-21T00:00:00.000Z",
        }),
        invoice({
          balance_due_cents: 10_000,
          due_at: "2026-09-30T00:00:00.000Z",
        }),
        invoice({
          presentation_state: "overdue",
          balance_due_cents: 10_000,
          is_overdue: true,
          due_at: "2026-08-01T00:00:00.000Z",
        }),
      ],
      NOW,
    );

    const entry = balance.currencies[0]!;
    expect(entry.invoiceCount).toBe(3);
    expect(entry.dueSoonCount).toBe(1);
    expect(entry.overdueCount).toBe(1);
  });

  it("describes a balance with overdue taking precedence over due-soon", () => {
    expect(
      describeCurrencyBalance({
        currency: "USD",
        outstandingCents: 1,
        invoiceCount: 2,
        overdueCount: 1,
        dueSoonCount: 1,
      }),
    ).toBe("2 unpaid invoices · 1 overdue");

    expect(
      describeCurrencyBalance({
        currency: "USD",
        outstandingCents: 1,
        invoiceCount: 1,
        overdueCount: 0,
        dueSoonCount: 1,
      }),
    ).toBe("1 unpaid invoice · 1 due this week");
  });
});

describe("invoice status vocabulary", () => {
  it("maps every presentation state the database can produce", () => {
    const states = [
      "draft",
      "unpaid",
      "overdue",
      "payment_pending",
      "paid",
      "partially_refunded",
      "refunded",
      "void",
    ] as const;

    for (const state of states) {
      const attention = invoiceAttention(state);
      expect(attention.label).not.toBe("—");
      expect(attention.tone).toBeTruthy();
    }

    expect(invoiceAttention("overdue")).toEqual({ tone: "payment_due", label: "Overdue" });
    expect(invoiceAttention("paid")).toEqual({ tone: "completed", label: "Paid" });
    expect(invoiceAttention("void")).toEqual({ tone: "idle", label: "Void" });
  });
});

describe("payment method state", () => {
  it("ships with no connected online payment provider", () => {
    // The single fact the whole surface derives from. If this ever becomes
    // non-empty by accident, every assertion below fails loudly.
    expect(connectedOnlinePaymentProviders).toEqual([]);
  });

  it("resolves to 'no provider' with the shipped configuration", () => {
    expect(resolvePaymentMethodState()).toEqual({ kind: "no_provider" });
  });

  it("never exposes a card even if stored methods somehow exist", () => {
    const method: StoredPaymentMethod = {
      id: "pm_1",
      providerId: "stripe",
      brand: "Visa",
      last4: "4242",
      expiryMonth: 8,
      expiryYear: 2029,
      isDefault: true,
    };

    // No provider connected: the method is not reachable, so nothing renders.
    const state = resolvePaymentMethodState({ methods: [method] });

    expect(state.kind).toBe("no_provider");
    expect(JSON.stringify(state)).not.toContain("4242");
    expect(JSON.stringify(state)).not.toContain("Visa");
  });

  it("reports 'provider connected, no method' once a provider exists", () => {
    expect(resolvePaymentMethodState({ providers: ["stripe"], methods: [] })).toEqual({
      kind: "provider_no_method",
      providers: ["stripe"],
    });
  });

  it("promotes the default method and keeps the rest secondary", () => {
    const methods: StoredPaymentMethod[] = [
      {
        id: "pm_1",
        providerId: "stripe",
        brand: "Mastercard",
        last4: "1111",
        expiryMonth: 1,
        expiryYear: 2030,
        isDefault: false,
      },
      {
        id: "pm_2",
        providerId: "stripe",
        brand: "Visa",
        last4: "4242",
        expiryMonth: 8,
        expiryYear: 2029,
        isDefault: true,
      },
    ];

    const state = resolvePaymentMethodState({ providers: ["stripe"], methods, now: NOW });

    expect(state.kind).toBe("method_on_file");
    if (state.kind !== "method_on_file") throw new Error("unreachable");
    expect(state.method.id).toBe("pm_2");
    expect(state.others.map((entry) => entry.id)).toEqual(["pm_1"]);
  });

  it("flags an expired default as needing attention", () => {
    const state = resolvePaymentMethodState({
      providers: ["stripe"],
      methods: [
        {
          id: "pm_1",
          providerId: "stripe",
          brand: "Visa",
          last4: "4242",
          expiryMonth: 7,
          expiryYear: 2026,
          isDefault: true,
        },
      ],
      now: NOW,
    });

    expect(state.kind).toBe("needs_attention");
  });

  it("treats a card as valid through the last day of its expiry month", () => {
    const method: StoredPaymentMethod = {
      id: "pm_1",
      providerId: "stripe",
      brand: "Visa",
      last4: "4242",
      expiryMonth: 8,
      expiryYear: 2026,
      isDefault: true,
    };

    expect(
      resolvePaymentMethodState({
        providers: ["stripe"],
        methods: [method],
        now: new Date("2026-08-31T23:59:00.000Z"),
      }).kind,
    ).toBe("method_on_file");

    expect(
      resolvePaymentMethodState({
        providers: ["stripe"],
        methods: [method],
        now: new Date("2026-09-01T00:00:00.000Z"),
      }).kind,
    ).toBe("needs_attention");
  });

  it("hides a method whose provider is not connected", () => {
    const state = resolvePaymentMethodState({
      providers: ["stripe"],
      methods: [
        {
          id: "pm_paypal",
          providerId: "paypal",
          brand: "PayPal",
          last4: "0000",
          expiryMonth: 1,
          expiryYear: 2030,
          isDefault: true,
        },
      ],
    });

    expect(state.kind).toBe("provider_no_method");
  });
});

describe("wallet funding", () => {
  it("only allows settlement on an active membership", () => {
    expect(
      resolveWalletFunding({ membershipStatus: "active", balanceCents: 5_000, currency: "USD" })
        .canSettleInvoices,
    ).toBe(true);

    for (const status of ["inactive", "pending", "cancelled", null] as const) {
      expect(
        resolveWalletFunding({ membershipStatus: status, balanceCents: 5_000, currency: "USD" })
          .canSettleInvoices,
      ).toBe(false);
    }
  });
});

describe("client billing language", () => {
  it("says investment, never spend", () => {
    expect(recurringAmountLabel("month", 1)).toBe("Monthly investment");
    expect(recurringAmountLabel("year", 1)).toBe("Annual investment");
    expect(recurringAmountLabel("month", 3)).toBe("Investment every 3 months");

    for (const label of [
      recurringAmountLabel("month", 1),
      recurringAmountLabel("year", 1),
      recurringAmountLabel("week", 2),
    ]) {
      expect(label.toLowerCase()).not.toContain("spend");
      expect(label.toLowerCase()).not.toContain("mrr");
    }
  });

  it("describes renewal in plain words", () => {
    expect(renewalCadence("month", 1)).toBe("Renews monthly");
    expect(renewalCadence("week", 2)).toBe("Renews every 2 weeks");
  });
});
