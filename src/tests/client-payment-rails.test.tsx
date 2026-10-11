/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ClientPaymentMethodView } from "../components/account/billing/client-payment-method";
import { BillingStripSection } from "../components/account/dashboard/billing-strip";
import { composeClientBalance } from "../domain/client-portal/balance";
import {
  connectedOnlinePaymentProviders,
  resolvePaymentMethodState,
  resolveWalletFunding,
} from "../domain/client-portal/payment-method";
import {
  alternativePaymentRails,
  composeClientPaymentRails,
  defaultPaymentRailId,
  externalPaymentRailAvailability,
  hasAlternativePaymentRail,
  paymentRailIds,
  primaryPaymentRail,
  resolveSelectedPaymentRailId,
  type ExternalPaymentRailAvailability,
} from "../domain/payments/payment-rails";
import { isBankTransferConfigured, isPayPalConfigured } from "../lib/env/payment-rail-env";

/**
 * The client payment rail foundation.
 *
 * What this phase actually is: Wolf Forge Balance presented truthfully as the
 * account's default payment method, plus PayPal and Bank Transfer shown as the
 * alternatives Wolf Forge intends to offer and has not connected. No money
 * moves through either. No PayPal API is called anywhere in the platform and no
 * bank is contacted.
 *
 * These assertions therefore split in two:
 *
 *   behaviour   the rails a client is offered, the figures they see, and the
 *               refusal to let an unconnected rail be chosen
 *   source      the boundaries that keep a credential out of a browser and keep
 *               fabricated bank details out of the markup
 *
 * The source-level checks follow the convention `stripe-customer-mapping.test.ts`
 * established: a module carrying `import "server-only"` cannot be imported into
 * a vitest graph, so its guarantees are asserted by reading it.
 */

afterEach(cleanup);

/* The wallet card reads prefers-reduced-motion, which jsdom does not implement. */
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

/** The availability every environment currently reports. */
const shipped: ExternalPaymentRailAvailability = {
  paypal: "not_connected",
  bank_transfer: "not_configured",
};

function railsFor({
  balanceCents = 50_000,
  currency = "USD",
  membershipStatus = "active" as "inactive" | "pending" | "active" | "cancelled",
  availability = shipped,
} = {}) {
  return composeClientPaymentRails({
    wallet: resolveWalletFunding({ membershipStatus, balanceCents, currency }),
    availability,
  });
}

function renderPage(options: Parameters<typeof railsFor>[0] = {}, workEnabled = true) {
  const wallet = resolveWalletFunding({
    membershipStatus: options.membershipStatus ?? "active",
    balanceCents: options.balanceCents ?? 50_000,
    currency: options.currency ?? "USD",
  });

  return render(
    <ClientPaymentMethodView
      rails={railsFor(options)}
      wallet={wallet}
      holderName="Jane Client"
      workEnabled={workEnabled}
    />,
  );
}

describe("payment rail model", () => {
  it("offers exactly three rails, with Wolf Forge Balance as the default", () => {
    expect(paymentRailIds).toEqual(["wf_balance", "paypal", "bank_transfer"]);
    expect(defaultPaymentRailId).toBe("wf_balance");

    const rails = railsFor();

    expect(primaryPaymentRail(rails)?.id).toBe("wf_balance");
    expect(primaryPaymentRail(rails)?.label).toBe("Wolf Forge Balance");
    expect(rails.filter((rail) => rail.isDefault)).toHaveLength(1);
    expect(alternativePaymentRails(rails).map((rail) => rail.id)).toEqual([
      "paypal",
      "bank_transfer",
    ]);
  });

  it("carries the real balance, and carries $0.00 just as truthfully", () => {
    expect(primaryPaymentRail(railsFor({ balanceCents: 50_000 }))?.detail).toBe(
      "$500.00 available",
    );
    expect(primaryPaymentRail(railsFor({ balanceCents: 0 }))?.detail).toBe("$0.00 available");

    // A zero balance is not a status: the rail is still this account's default.
    const zero = primaryPaymentRail(railsFor({ balanceCents: 0 }));
    expect(zero?.isDefault).toBe(true);
    expect(zero?.isAvailable).toBe(true);
    expect(zero?.statusLabel).toBeNull();
  });

  it("respects the currency the wallet is actually held in", () => {
    expect(primaryPaymentRail(railsFor({ balanceCents: 12_345, currency: "EUR" }))?.detail).toBe(
      "€123.45 available",
    );
  });

  it("mirrors the membership gate the payment RPC enforces", () => {
    const inactive = primaryPaymentRail(railsFor({ membershipStatus: "inactive" }));

    expect(inactive?.isAvailable).toBe(false);
    expect(inactive?.status).toBe("membership_required");
    // Still the default: an unusable rail is not a missing payment method.
    expect(inactive?.isDefault).toBe(true);
  });

  it("reports PayPal and Bank Transfer with their own truthful states", () => {
    const [, paypal, bank] = railsFor();

    expect(paypal!.label).toBe("PayPal");
    expect(paypal!.isAvailable).toBe(false);
    expect(paypal!.statusLabel).toBe("Not connected yet");

    expect(bank!.label).toBe("Bank Transfer");
    expect(bank!.isAvailable).toBe(false);
    expect(bank!.statusLabel).toBe("Not configured yet");

    // Nothing invented behind either: no account, no instrument, no figure.
    expect(paypal!.detail).toBeNull();
    expect(bank!.detail).toBeNull();
  });

  it("never carries a credential or an account identifier on a rail", () => {
    const serialised = JSON.stringify(railsFor());

    expect(serialised).not.toMatch(/PAYPAL_|CLIENT_SECRET|WEBHOOK_ID/u);
    expect(serialised).not.toMatch(/iban|routing|sort code|account number|swift|bic/iu);
  });

  it("refuses to select a rail that cannot be used", () => {
    const statuses = {
      wf_balance: "available",
      paypal: "not_connected",
      bank_transfer: "not_configured",
    } as const;

    expect(resolveSelectedPaymentRailId("paypal", statuses)).toBe("wf_balance");
    expect(resolveSelectedPaymentRailId("bank_transfer", statuses)).toBe("wf_balance");
    expect(resolveSelectedPaymentRailId(null, statuses)).toBe("wf_balance");
    // A value from outside the model — a URL, a stale stored preference.
    expect(
      resolveSelectedPaymentRailId("stripe" as never, statuses),
    ).toBe("wf_balance");

    // Composing with an unavailable request cannot mark it selected either.
    const rails = composeClientPaymentRails({
      wallet: resolveWalletFunding({
        membershipStatus: "active",
        balanceCents: 1,
        currency: "USD",
      }),
      availability: shipped,
      selectedRailId: "paypal",
    });

    expect(rails.find((rail) => rail.isSelected)?.id).toBe("wf_balance");
  });

  it("honours a rail once it genuinely becomes available", () => {
    const statuses = {
      wf_balance: "available",
      paypal: "available",
      bank_transfer: "not_configured",
    } as const;

    expect(resolveSelectedPaymentRailId("paypal", statuses)).toBe("paypal");
    expect(hasAlternativePaymentRail(railsFor())).toBe(false);
    expect(
      hasAlternativePaymentRail(
        railsFor({ availability: { paypal: "available", bank_transfer: "not_configured" } }),
      ),
    ).toBe(true);
  });
});

describe("provider availability comes from server configuration", () => {
  it("treats an unconfigured environment as unavailable, not as connected", () => {
    expect(isPayPalConfigured({})).toBe(false);
    expect(isBankTransferConfigured({})).toBe(false);

    expect(
      externalPaymentRailAvailability({
        paypalConfigured: false,
        bankTransferConfigured: false,
      }),
    ).toEqual(shipped);
  });

  it("requires the whole PayPal credential set, never a partial one", () => {
    expect(isPayPalConfigured({ PAYPAL_CLIENT_ID: "id" })).toBe(false);
    expect(isPayPalConfigured({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s" })).toBe(false);
    expect(
      isPayPalConfigured({
        PAYPAL_CLIENT_ID: "id",
        PAYPAL_CLIENT_SECRET: "s",
        PAYPAL_WEBHOOK_ID: "w",
      }),
    ).toBe(true);
  });

  it("makes bank transfer available only when an operator declares a mode", () => {
    expect(isBankTransferConfigured({ BANK_TRANSFER_MODE: "manual" })).toBe(true);
    expect(isBankTransferConfigured({ BANK_TRANSFER_MODE: "provider" })).toBe(true);
    // A stray or misspelled value must not flip the rail on.
    expect(isBankTransferConfigured({ BANK_TRANSFER_MODE: "yes" })).toBe(false);
  });

  it("turns configuration into availability and nothing else", () => {
    expect(
      externalPaymentRailAvailability({ paypalConfigured: true, bankTransferConfigured: true }),
    ).toEqual({ paypal: "available", bank_transfer: "available" });
  });
});

describe("client payment method page", () => {
  it("leads with Wolf Forge Balance, marked as the default", () => {
    renderPage();

    const heading = screen.getByRole("heading", { name: "Wolf Forge Balance" });
    const anchor = heading.closest("article")!;

    expect(within(anchor).getByText("Default")).toBeInTheDocument();
    expect(within(anchor).getByText("available")).toBeInTheDocument();
    /*
     * Twice on purpose: the wallet card and the figure beside it read the same
     * wallet, so the page cannot show two different balances.
     */
    expect(within(anchor).getAllByText("$500.00")).toHaveLength(2);
  });

  it("shows a zero balance rather than hiding the rail", () => {
    renderPage({ balanceCents: 0 });

    const anchor = screen.getByRole("heading", { name: "Wolf Forge Balance" }).closest("article")!;

    expect(within(anchor).getAllByText("$0.00").length).toBeGreaterThan(0);
    expect(within(anchor).getByText("Default")).toBeInTheDocument();
  });

  it("states the membership gate instead of silently offering a rail that would fail", () => {
    renderPage({ membershipStatus: "inactive" });

    expect(screen.getByText(/WF Card membership unlocks wallet payments/u)).toBeInTheDocument();
  });

  it("retains the wallet balance while OFF and explains that new Invoice work is unavailable", () => {
    renderPage({ membershipStatus: "inactive" }, false);
    expect(screen.getByText(/Invoices is disabled\. Your wallet balance and history remain available/u)).toBeInTheDocument();
    expect(screen.getByText(/Your recorded wallet balance remains yours/u)).toBeInTheDocument();
    expect(screen.queryByText(/activate it from an open invoice/u)).not.toBeInTheDocument();
    expect(screen.getAllByText("$500.00").length).toBeGreaterThan(0);
  });

  it("does not offer instant settlement or method selection to an active member while OFF", () => {
    renderPage({ membershipStatus: "active" }, false);
    expect(screen.getByText("recorded balance")).toBeInTheDocument();
    expect(screen.queryByText(/Settle any invoice instantly/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Change payment method/u })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to invoices" })).toHaveAttribute("href", "/account/invoices");
  });

  it("lists PayPal and Bank Transfer with their real, non-working states", () => {
    renderPage();

    const others = screen.getByRole("heading", { name: "Other payment methods" }).closest("section")!;

    expect(within(others).getByText("PayPal")).toBeInTheDocument();
    expect(within(others).getByText("Not connected yet")).toBeInTheDocument();
    expect(within(others).getByText("Bank Transfer")).toBeInTheDocument();
    expect(within(others).getByText("Not configured yet")).toBeInTheDocument();
  });

  it("renders no bank details, because Wolf Forge holds none", () => {
    const { container } = renderPage();
    const markup = container.textContent ?? "";

    expect(markup).not.toMatch(/iban|routing|sort code|account number|swift|bic|beneficiary/iu);
    // No long digit run that could read as an account or card number.
    expect(markup).not.toMatch(/\d[\d\s-]{7,}/u);
    // No PayPal account, email or merchant identity.
    expect(markup).not.toMatch(/@|merchant/iu);
  });

  it("renders no card brand, last four or expiry", () => {
    const { container } = renderPage();
    const markup = container.textContent ?? "";

    expect(markup).not.toMatch(/Visa|Mastercard|Amex|••••|Expires/iu);
    expect(markup).not.toContain("No payment method on file");
  });

  it("does not offer Stripe or a card as a client payment method", () => {
    const { container } = renderPage();

    expect(container.textContent).not.toMatch(/stripe/iu);
    expect(railsFor().map((rail) => rail.id)).not.toContain("stripe");
  });
});

describe("change payment method selector", () => {
  function openSelector() {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Change payment method/u }));
    return screen.getByRole("dialog");
  }

  it("opens a dialog listing every rail", () => {
    const dialog = openSelector();

    expect(within(dialog).getByRole("heading", { name: "Select payment method" })).toBeInTheDocument();
    expect(within(dialog).getAllByRole("radio")).toHaveLength(3);
  });

  it("starts on Wolf Forge Balance", () => {
    const dialog = openSelector();

    expect(within(dialog).getByRole("radio", { name: /Wolf Forge Balance/u })).toBeChecked();
  });

  /*
   * Selection is asserted through the row's data-selected, which React owns,
   * rather than through input.checked. jsdom applies a click's default
   * activation to a disabled input where a browser would not, so input.checked
   * would report a state the component never entered.
   */
  function selectedRow(dialog: HTMLElement, name: RegExp): HTMLElement {
    return within(dialog).getByRole("radio", { name }).closest("label")!;
  }

  it("cannot select PayPal while it is not connected", () => {
    const dialog = openSelector();
    const paypal = within(dialog).getByRole("radio", { name: /PayPal/u });

    expect(paypal).toBeDisabled();

    fireEvent.click(paypal);

    expect(selectedRow(dialog, /PayPal/u)).toHaveAttribute("data-selected", "false");
    expect(selectedRow(dialog, /Wolf Forge Balance/u)).toHaveAttribute("data-selected", "true");
  });

  it("cannot select Bank Transfer while it is not configured", () => {
    const dialog = openSelector();
    const bank = within(dialog).getByRole("radio", { name: /Bank Transfer/u });

    expect(bank).toBeDisabled();

    fireEvent.click(bank);

    expect(selectedRow(dialog, /Bank Transfer/u)).toHaveAttribute("data-selected", "false");
    expect(selectedRow(dialog, /Wolf Forge Balance/u)).toHaveAttribute("data-selected", "true");
  });

  it("says plainly that there is nothing else to choose yet", () => {
    const dialog = openSelector();

    expect(
      within(dialog).getByText(/only payment method available right now/u),
    ).toBeInTheDocument();
  });

  it("offers no save action, because nothing is persisted", () => {
    const dialog = openSelector();
    const labels = within(dialog)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "");

    expect(labels.join(" ")).not.toMatch(/save|confirm|apply/iu);
  });
});

describe("dashboard billing strip", () => {
  const balance = composeClientBalance([], new Date("2026-08-20T00:00:00.000Z"));

  it("names Wolf Forge Balance instead of claiming there is no payment method", () => {
    render(
      <BillingStripSection
        balance={balance}
        nextBilling={null}
        activeSubscriptionCount={0}
        paymentRails={railsFor()}
      />,
    );

    const billing = screen.getByRole("heading", { name: "Billing" }).closest("section")!;

    expect(within(billing).getByText("Wolf Forge Balance")).toBeInTheDocument();
    expect(within(billing).getByText("$500.00 available")).toBeInTheDocument();
    expect(within(billing).getByText("Default payment method")).toBeInTheDocument();
    expect(billing.textContent).not.toContain("No payment method on file");
  });

  it("still names the rail at a zero balance", () => {
    render(
      <BillingStripSection
        balance={balance}
        nextBilling={null}
        activeSubscriptionCount={0}
        paymentRails={railsFor({ balanceCents: 0 })}
      />,
    );

    expect(screen.getByText("$0.00 available")).toBeInTheDocument();
  });

  it("claims nothing about PayPal or bank transfer", () => {
    render(
      <BillingStripSection
        balance={balance}
        nextBilling={null}
        activeSubscriptionCount={0}
        paymentRails={railsFor()}
      />,
    );

    const billing = screen.getByRole("heading", { name: "Billing" }).closest("section")!;

    expect(billing.textContent).not.toMatch(/PayPal|Bank Transfer/u);
  });

  it("omits the zone entirely when the Invoices module is denied", () => {
    render(
      <BillingStripSection
        balance={balance}
        nextBilling={null}
        activeSubscriptionCount={0}
        paymentRails={null}
      />,
    );

    const billing = screen.getByRole("heading", { name: "Billing" }).closest("section")!;

    expect(billing.textContent).not.toContain("Payment method");
  });
});

describe("security boundaries", () => {
  it("keeps every payment provider module behind server-only", () => {
    expect(read("lib/payments/payment-rail-configuration.ts")).toContain('import "server-only"');
    expect(read("lib/payments/paypal-gateway.ts")).toContain('import "server-only"');
    expect(read("lib/payments/bank-transfer.ts")).toContain('import "server-only"');
  });

  it("never names a PayPal credential with a browser-exposed prefix", () => {
    const env = read("lib/env/payment-rail-env.ts");

    expect(env).toContain("PAYPAL_CLIENT_SECRET");
    // NEXT_PUBLIC_ is the bundler's own rule for what may reach a browser.
    expect(env).not.toContain("NEXT_PUBLIC_PAYPAL");
    expect(env).not.toContain("NEXT_PUBLIC_BANK");
  });

  it("keeps the environment reader out of every client component on this surface", () => {
    for (const file of [
      "components/account/billing/client-payment-method.tsx",
      "components/account/billing/payment-rail-switcher.tsx",
      "components/account/dashboard/billing-strip.tsx",
    ]) {
      const source = read(file);
      expect(source).not.toContain("payment-rail-env");
      expect(source).not.toContain("lib/payments/");
      expect(source).not.toContain("PAYPAL_");
      expect(source).not.toContain("process.env");
    }

    // The one client component here reaches the domain only.
    const switcher = read("components/account/billing/payment-rail-switcher.tsx");
    expect(switcher).toContain('"use client"');
    expect(switcher).toContain("domain/payments/payment-rails");
  });

  it("makes no PayPal call and installs no PayPal SDK", () => {
    const gateway = read("lib/payments/paypal-gateway.ts");

    expect(gateway).not.toMatch(/fetch\(|axios|https:\/\/api[.-]/u);
    expect(gateway).not.toContain("readPayPalEnvironment");
    // The seam refuses rather than pretending a payment succeeded.
    expect(gateway).toContain("PayPal is not connected to Wolf Forge yet.");

    const manifest = JSON.parse(read("../package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const installed = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(installed.filter((name) => /paypal/iu.test(name))).toEqual([]);
  });

  it("invents no bank details anywhere in the rail foundation", () => {
    for (const file of [
      "lib/payments/bank-transfer.ts",
      "domain/payments/payment-rails.ts",
      "components/account/billing/client-payment-method.tsx",
    ]) {
      const source = read(file);
      // Any 6+ digit run would be an account, routing or sort code shape.
      expect(source).not.toMatch(/\b\d{6,}\b/u);
    }
  });

  it("gives the client no way to change provider configuration or a balance", () => {
    for (const file of [
      "domain/payments/payment-rails.ts",
      "lib/payments/payment-rail-configuration.ts",
      "lib/payments/bank-transfer.ts",
      "components/account/billing/payment-rail-switcher.tsx",
    ]) {
      const source = read(file);
      expect(source).not.toContain('"use server"');
      expect(source).not.toContain("createUserSupabaseClient");
      expect(source).not.toContain(".rpc(");
    }

    /*
     * The balance is read server-side from the company the verified session
     * resolves to, never from anything the browser sends. The loader is the
     * proof: the company id comes from the context, not from an argument.
     */
    const loader = read("lib/supabase/client-portal-data.ts");
    expect(loader).toContain("context.services.wallets.getForCompany(context.user.companyId)");
    expect(loader).toContain("readExternalPaymentRailAvailability()");
  });

  it("leaves the parked Stripe work exactly as it was", () => {
    // Stripe is still not a client payment provider and still has no methods.
    expect(connectedOnlinePaymentProviders).toEqual([]);
    expect(resolvePaymentMethodState()).toEqual({ kind: "no_provider" });

    // Nothing in the rail foundation reaches the Stripe modules.
    for (const file of [
      "domain/payments/payment-rails.ts",
      "lib/payments/payment-rail-configuration.ts",
      "lib/payments/paypal-gateway.ts",
      "lib/env/payment-rail-env.ts",
      "components/account/billing/client-payment-method.tsx",
    ]) {
      expect(read(file)).not.toMatch(/from "[^"]*stripe/u);
    }

    // Stripe's own secret handling is untouched and still its own reader.
    const stripeEnv = read("lib/env/stripe-env.ts");
    expect(stripeEnv).toContain("STRIPE_SECRET_KEY");
    expect(stripeEnv).not.toContain("PAYPAL");
    expect(read("lib/stripe/stripe-client.ts")).toContain('import "server-only"');
  });
});
