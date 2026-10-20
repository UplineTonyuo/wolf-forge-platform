/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../app/actions/wf-card", () => ({
  payInvoiceWithWfCardAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { InvoiceItemScope } from "../components/account/billing/invoice-item-scope";
import { InvoicePaymentSelector } from "../components/invoices/invoice-payment-selector";
import { resolveWalletFunding } from "../domain/client-portal/payment-method";
import { composeInvoiceSettlementPlan } from "../domain/payments/invoice-settlement";
import {
  composeClientPaymentRails,
  type ExternalPaymentRailAvailability,
} from "../domain/payments/payment-rails";
import {
  composeServiceScope,
  scopeSummaryLine,
} from "../domain/services/service-summary";

/**
 * Two things, one pass: invoice line-item scope, and balance-first settlement.
 *
 * The settled rule under test: an invoice larger than the Wolf Forge Balance
 * applies the balance FIRST and leaves a remainder for an external rail. $780
 * against $500 is $500 + $280.
 *
 * The other half of the truth, also under test: that split is not executable
 * today. `app_pay_invoice_with_wallet` takes no amount and refuses a wallet that
 * cannot cover the invoice in full, and neither PayPal nor bank transfer is
 * connected to collect a remainder. So these assertions check both that the
 * arithmetic is right AND that nothing on the surface claims a payment it
 * cannot complete.
 */

afterEach(cleanup);

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const root = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

/** Neither external rail is connected — the state on every environment today. */
const shipped: ExternalPaymentRailAvailability = {
  paypal: "not_connected",
  bank_transfer: "not_configured",
};

const connected: ExternalPaymentRailAvailability = {
  paypal: "available",
  bank_transfer: "not_configured",
};

function plan({
  invoiceDueCents = 78_000,
  walletBalanceCents = 50_000,
  currency = "USD",
  walletCurrency = "USD",
  membershipStatus = "active" as "inactive" | "pending" | "active" | "cancelled",
  collectible = true,
  availability = shipped,
} = {}) {
  const rails = composeClientPaymentRails({
    wallet: resolveWalletFunding({ membershipStatus, balanceCents: walletBalanceCents, currency: walletCurrency }),
    availability,
  });

  return composeInvoiceSettlementPlan({
    invoiceDueCents,
    currency,
    walletBalanceCents,
    walletCurrency,
    membershipStatus,
    collectible,
    externalRailStatuses: rails
      .filter((rail) => rail.id !== "wf_balance")
      .map((rail) => rail.status),
  });
}

/*
 * A capture in the shape the real catalogue stores: an emoji headline, a prose
 * lead, a shouted heading, check-mark inclusions, a repeat, and an instruction
 * addressed to the buyer.
 */
const capturedDescription = [
  "<div>🐺 MAPS OPTIMIZATION SYSTEM</div>",
  "<div>Your Google Business Profile might be costing you customers every single day that it sits unoptimised.</div>",
  "<div>✅ WHAT'S INCLUDED:</div>",
  "<div>✅ 100 Citations</div>",
  "<div>✅ 1 Blog per month</div>",
  "<div>✅ Weekly reporting</div>",
  "<div>✅ 100 Citations</div>",
  "<div>✅ You must supply your logo in SVG</div>",
].join("");

describe("invoice item scope", () => {
  it("strips emoji and bullet glyphs out of every line", () => {
    const scope = composeServiceScope(capturedDescription);
    const everything = [scope.summary, ...scope.deliverables, ...scope.requirements, ...scope.notes];

    for (const line of everything) {
      expect(line).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      expect(line).not.toMatch(/^[✅✔✓•·\-–—*+>]/u);
    }
  });

  it("keeps the real deliverables, deduplicated and in source order", () => {
    const scope = composeServiceScope(capturedDescription);

    expect(scope.deliverables).toEqual([
      "100 Citations",
      "1 Blog per month",
      "Weekly reporting",
    ]);
  });

  it("separates an instruction to the buyer from what they receive", () => {
    const scope = composeServiceScope(capturedDescription);

    expect(scope.requirements).toEqual(["You must supply your logo in SVG"]);
    expect(scope.deliverables).not.toContain("You must supply your logo in SVG");
  });

  it("collapses to the prose lead when the description has one", () => {
    expect(scopeSummaryLine(composeServiceScope(capturedDescription))).toMatch(
      /Google Business Profile/u,
    );
  });

  it("collapses to an honest count when the description is inclusions only", () => {
    const scope = composeServiceScope(
      "<div>✅ 100 Citations</div><div>✅ 1 Blog per month</div>",
    );

    expect(scopeSummaryLine(scope)).toBe("Includes 2 deliverables");
    expect(scopeSummaryLine(composeServiceScope("<div>✅ 100 Citations</div>"))).toBe(
      "Includes 1 deliverable",
    );
  });

  it("reports nothing to expand for an empty description", () => {
    const scope = composeServiceScope(null);

    expect(scope.hasDetail).toBe(false);
    expect(scopeSummaryLine(scope)).toBe("");
  });

  it("renders collapsed by default and expands on request", () => {
    render(<InvoiceItemScope scope={composeServiceScope(capturedDescription)} />);

    const toggle = screen.getByRole("button", { name: /View deliverables/u });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Collapsed: the summary is visible, the deliverables are not.
    expect(screen.getByText(/Google Business Profile/u)).toBeInTheDocument();
    expect(screen.queryByText("100 Citations")).not.toBeVisible();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("100 Citations")).toBeVisible();
    expect(screen.getByText("Weekly reporting")).toBeVisible();
    expect(screen.getByRole("button", { name: /Hide deliverables/u })).toBeInTheDocument();
  });

  it("keeps the panel addressable by the control that toggles it", () => {
    const { container } = render(
      <InvoiceItemScope scope={composeServiceScope(capturedDescription)} />,
    );

    const toggle = screen.getByRole("button", { name: /View deliverables/u });
    const panelId = toggle.getAttribute("aria-controls")!;

    // Present even while collapsed, so the reference never dangles.
    expect(container.querySelector(`#${CSS.escape(panelId)}`)).not.toBeNull();
  });

  it("labels requirements rather than listing them as deliverables", () => {
    render(<InvoiceItemScope scope={composeServiceScope(capturedDescription)} />);
    fireEvent.click(screen.getByRole("button", { name: /View deliverables/u }));

    expect(screen.getByText("What we’ll need from you")).toBeInTheDocument();
  });

  it("renders no toggle when there is nothing behind it", () => {
    render(
      <InvoiceItemScope
        scope={composeServiceScope(
          "<div>A straightforward one-off audit of your website performance and technical health.</div>",
        )}
      />,
    );

    expect(screen.queryByRole("button", { name: /deliverables/u })).toBeNull();
  });
});

describe("balance-first settlement arithmetic", () => {
  it("A — the balance covers the invoice in full", () => {
    const result = plan({ invoiceDueCents: 40_000, walletBalanceCents: 50_000 });

    expect(result.walletAppliedCents).toBe(40_000);
    expect(result.remainingCents).toBe(0);
    expect(result.fullyCoveredByWallet).toBe(true);
    expect(result.isSplit).toBe(false);
    expect(result.executableNow).toBe(true);
    expect(result.blocker).toBeNull();
  });

  it("B — a partial balance is applied first and the rest remains", () => {
    // The settled example: $780 invoice, $500 balance.
    const result = plan({ invoiceDueCents: 78_000, walletBalanceCents: 50_000 });

    expect(result.walletAppliedCents).toBe(50_000);
    expect(result.remainingCents).toBe(28_000);
    expect(result.fullyCoveredByWallet).toBe(false);
    expect(result.isSplit).toBe(true);
    // Not executable: the wallet RPC is all-or-nothing and no rail is connected.
    expect(result.executableNow).toBe(false);
    expect(result.blocker).toBe("external_rail_unavailable");
  });

  it("C — a zero balance leaves the whole amount external", () => {
    const result = plan({ invoiceDueCents: 78_000, walletBalanceCents: 0 });

    expect(result.walletAppliedCents).toBe(0);
    expect(result.remainingCents).toBe(78_000);
    expect(result.isSplit).toBe(false);
    expect(result.walletBlocker).toBe("empty_balance");
    expect(result.executableNow).toBe(false);
  });

  it("applies exactly the balance, never a rounded or invented figure", () => {
    const result = plan({ invoiceDueCents: 78_000, walletBalanceCents: 18_417 });

    expect(result.walletAppliedCents).toBe(18_417);
    expect(result.remainingCents).toBe(78_000 - 18_417);
    // The parts always reconstruct the whole.
    expect(result.walletAppliedCents + result.remainingCents).toBe(result.invoiceDueCents);
  });

  it("applies nothing without an active membership, whatever the balance says", () => {
    for (const status of ["inactive", "pending", "cancelled"] as const) {
      const result = plan({ walletBalanceCents: 50_000, membershipStatus: status });

      expect(result.walletAppliedCents).toBe(0);
      expect(result.remainingCents).toBe(78_000);
      expect(result.walletBlocker).toBe("membership_required");
      expect(result.blocker).toBe("membership_required");
    }
  });

  it("applies nothing when the wallet holds a different currency", () => {
    const result = plan({ currency: "USD", walletCurrency: "EUR", walletBalanceCents: 50_000 });

    expect(result.walletAppliedCents).toBe(0);
    expect(result.walletBlocker).toBe("currency_mismatch");
    expect(result.remainingCents).toBe(78_000);
  });

  it("never produces a negative remainder or a negative application", () => {
    const result = plan({ invoiceDueCents: -500, walletBalanceCents: -900 });

    expect(result.invoiceDueCents).toBe(0);
    expect(result.walletBalanceCents).toBe(0);
    expect(result.remainingCents).toBe(0);
    expect(result.walletAppliedCents).toBe(0);
  });

  it("refuses to plan a payment for an invoice that is not collectible", () => {
    const result = plan({ collectible: false });

    expect(result.executableNow).toBe(false);
    expect(result.blocker).toBe("not_collectible");
  });

  it("reports the next step, not a fault, once a rail is genuinely connected", () => {
    const result = plan({ availability: connected });

    expect(result.remainingCents).toBe(28_000);
    expect(result.blocker).toBe("external_payment_required");
    // Still not executable in code: no capture path exists yet.
    expect(result.executableNow).toBe(false);
  });
});

describe("invoice payment surface", () => {
  const baseProps = {
    invoiceId: "11111111-1111-4111-8111-111111111111",
    holderName: "Acme Forge",
    currency: "USD",
    walletCurrency: "USD",
    membershipPriceCents: 25_900,
    membershipCurrency: "USD",
    collectible: true,
    membershipStatus: "active" as const,
  };

  function renderSelector({
    invoiceBalanceCents = 78_000,
    walletBalanceCents = 50_000,
    availability = shipped,
    membershipStatus = baseProps.membershipStatus,
  }: {
    invoiceBalanceCents?: number;
    walletBalanceCents?: number;
    availability?: ExternalPaymentRailAvailability;
    membershipStatus?: "inactive" | "pending" | "active" | "cancelled";
  } = {}) {
    const rails = composeClientPaymentRails({
      wallet: resolveWalletFunding({
        membershipStatus,
        balanceCents: walletBalanceCents,
        currency: baseProps.walletCurrency,
      }),
      availability,
    });

    return render(
      <InvoicePaymentSelector
        {...baseProps}
        membershipStatus={membershipStatus}
        invoiceBalanceCents={invoiceBalanceCents}
        walletBalanceCents={walletBalanceCents}
        paymentRails={rails}
      />,
    );
  }

  it("shows the breakdown with the balance applied first", () => {
    renderSelector();

    expect(screen.getByText("Payment breakdown")).toBeInTheDocument();
    expect(screen.getByText("Invoice total")).toBeInTheDocument();
    expect(screen.getByText("$780.00")).toBeInTheDocument();
    expect(screen.getByText("Wolf Forge Balance applied")).toBeInTheDocument();
    expect(screen.getByText("−$500.00")).toBeInTheDocument();
    expect(screen.getByText("Remaining due externally")).toBeInTheDocument();
    expect(screen.getByText("$280.00")).toBeInTheDocument();
  });

  it("offers the external rails only for the remaining amount", () => {
    renderSelector();

    expect(
      screen.getByText("Choose how to pay the remaining $280.00"),
    ).toBeInTheDocument();

    // Never the full invoice figure on the remainder control.
    expect(screen.queryByText(/remaining \$780\.00/u)).not.toBeInTheDocument();
  });

  it("keeps an unconnected rail visible, truthful and unselectable", () => {
    renderSelector();

    const paypal = screen.getByRole("radio", { name: /PayPal/u });
    expect(paypal).toBeDisabled();
    expect(screen.getByText("Not connected yet")).toBeInTheDocument();

    fireEvent.click(paypal);

    expect(paypal.closest("label")).toHaveAttribute("data-selected", "false");
  });

  it("introduces no fake payment success", () => {
    const { container } = renderSelector();
    const markup = container.textContent ?? "";

    expect(markup).not.toMatch(/paid in full|payment complete|successfully paid|receipt/iu);
    // A partial wallet debit is not executable, so no pay button may exist.
    expect(screen.queryByRole("button", { name: /^Pay /u })).toBeNull();
    expect(screen.getByText(/cannot be paid online/u)).toBeInTheDocument();
  });

  it("says no external payment is needed when the balance covers it", () => {
    renderSelector({ invoiceBalanceCents: 40_000, walletBalanceCents: 50_000 });

    expect(screen.getByText(/covers this invoice in full/u)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /PayPal/u })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Pay $400.00 with Wolf Forge Balance" }),
    ).toBeEnabled();
  });

  it("puts the whole invoice on the external rails at a zero balance", () => {
    renderSelector({ invoiceBalanceCents: 78_000, walletBalanceCents: 0 });

    expect(
      screen.getByText("Choose how to pay the remaining $780.00"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Wolf Forge Balance is \$0\.00/u)).toBeInTheDocument();
    // No credit line for a balance that contributed nothing.
    expect(screen.queryByText("Wolf Forge Balance applied")).not.toBeInTheDocument();
  });

  it("names the membership gate rather than blaming the balance", () => {
    renderSelector({ walletBalanceCents: 50_000, membershipStatus: "inactive" });

    expect(screen.getByText(/active WF Card membership is required/u)).toBeInTheDocument();
    expect(screen.queryByText("Wolf Forge Balance applied")).not.toBeInTheDocument();
  });

  it("never surfaces Stripe as a client payment option", () => {
    const { container } = renderSelector();
    const rails = screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"));

    expect(rails).toEqual(["paypal", "bank_transfer"]);
    expect(container.textContent).not.toMatch(/stripe|card number|cvv/iu);
  });
});

describe("boundaries", () => {
  it("leaves the audited wallet settlement path untouched", () => {
    const action = read("app/actions/wf-card.ts");

    // Still the same all-or-nothing RPC call, with no amount from the browser.
    expect(read("repositories/wf-card-repository.ts")).toContain("app_pay_invoice_with_wallet");
    expect(read("repositories/wf-card-repository.ts")).not.toMatch(/p_amount|amount_cents:/u);
    expect(action).toContain("payInvoiceWithWfCardAction");
    expect(action).not.toMatch(/amountCents|p_amount/u);
  });

  it("computes the split in the domain, never in a component", () => {
    const selector = read("components/invoices/invoice-payment-selector.tsx");

    expect(selector).toContain("composeInvoiceSettlementPlan");
    // No arithmetic on money in the view.
    expect(selector).not.toMatch(/invoiceBalanceCents\s*-\s*walletBalanceCents/u);
    expect(selector).not.toMatch(/Math\.min\(|Math\.max\(/u);
  });

  it("leaves the parked Stripe work alone", () => {
    for (const file of [
      "domain/payments/invoice-settlement.ts",
      "components/invoices/invoice-payment-selector.tsx",
      "domain/services/service-summary.ts",
      "components/account/billing/invoice-item-scope.tsx",
    ]) {
      expect(read(file)).not.toMatch(/from "[^"]*stripe/u);
    }

    expect(read("lib/env/stripe-env.ts")).toContain("STRIPE_SECRET_KEY");
  });

  it("adds no membership write path, because none exists to call", () => {
    const selector = read("components/invoices/invoice-payment-selector.tsx");

    expect(selector).not.toMatch(/activateMembership|purchaseMembership|buyMembership/u);
    expect(selector).not.toContain('"use server"');
  });
});
