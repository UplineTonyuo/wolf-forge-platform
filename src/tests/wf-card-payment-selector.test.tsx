/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../app/actions/wf-card", () => ({
  payInvoiceWithWfCardAction: vi.fn(),
}));
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { payInvoiceWithWfCardAction } from "../app/actions/wf-card";

import { InvoicePaymentSelector } from "../components/invoices/invoice-payment-selector";
import { resolveWalletFunding } from "../domain/client-portal/payment-method";
import { composeClientPaymentRails } from "../domain/payments/payment-rails";

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

/** The shipped rail configuration: neither external rail is connected. */
const shippedRails = composeClientPaymentRails({
  wallet: resolveWalletFunding({
    membershipStatus: "active",
    balanceCents: 68_417,
    currency: "USD",
  }),
  availability: { paypal: "not_connected", bank_transfer: "not_configured" },
});

const baseProps = {
  invoiceId: "11111111-1111-4111-8111-111111111111",
  holderName: "Acme Forge",
  invoiceBalanceCents: 49_700,
  currency: "USD",
  walletBalanceCents: 68_417,
  walletCurrency: "USD",
  membershipPriceCents: 25_900,
  membershipCurrency: "USD",
  collectible: true,
  paymentRails: shippedRails,
};

afterEach(cleanup);

describe("WF Card invoice payment selector", () => {
  it("refreshes the server-rendered receipt after successful settlement", async () => {
    refresh.mockClear();
    vi.mocked(payInvoiceWithWfCardAction).mockResolvedValue({ ok: true, walletBalanceCents: 18_717, invoiceBalanceCents: 0 });
    render(<InvoicePaymentSelector {...baseProps} membershipStatus="active" />);
    fireEvent.click(screen.getByRole("button", { name: "Pay $497.00 with Wolf Forge Balance" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(payInvoiceWithWfCardAction).toHaveBeenCalledTimes(1);
  });
  it("reuses the approved wallet card and defaults active members to WF Card", () => {
    const { container } = render(
      <InvoicePaymentSelector {...baseProps} membershipStatus="active" />,
    );

    expect(container.querySelector(".wolf-wallet-final")).toBeInTheDocument();
    /*
     * Client POV wording. The card is shared with the admin surface, which
     * keeps "Client Wallet" — a client is never addressed as "Client" inside
     * their own workspace.
     */
    expect(screen.getByText(/your wallet/i)).toBeInTheDocument();
    expect(screen.queryByText(/client wallet/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Available Balance").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$684.17").length).toBeGreaterThan(0);
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByText("Member benefits active")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Pay $497.00 with Wolf Forge Balance" }),
    ).toBeEnabled();
  });

  it("keeps WF Card first and visible for non-members with a locked treatment", () => {
    const { container } = render(
      <InvoicePaymentSelector {...baseProps} membershipStatus="inactive" />,
    );

    expect(container.querySelector(".wolf-wallet-final")).toBeInTheDocument();
    expect(screen.getByText("Members only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock WF Card" })).toBeEnabled();
  });

  it("opens the $259 membership modal as a preview, never as a checkout", () => {
    render(<InvoicePaymentSelector {...baseProps} membershipStatus="inactive" />);
    fireEvent.click(screen.getByRole("button", { name: "Unlock WF Card" }));

    const dialog = screen.getByRole("dialog", { name: "Wolf Forge Membership" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("$259")).toBeInTheDocument();
    expect(screen.getByText("Cashback opportunities")).toBeInTheDocument();

    /*
     * There is no write path for wf_card_memberships anywhere — no RPC, no
     * service, no action — so the dialog must not offer a purchase. It states
     * the position up front rather than after a click that does nothing.
     */
    expect(screen.getByText("Membership opens soon")).toBeInTheDocument();
    expect(screen.getByText(/not open for purchase yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Get WF Card/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /buy|purchase|checkout|activate/i })).toBeNull();

    // The one CTA goes somewhere that genuinely works.
    expect(screen.getByRole("link", { name: /Ask about membership/i })).toHaveAttribute(
      "href",
      "/account/messages?compose=1",
    );
    expect(screen.getByText("Locked")).toBeInTheDocument();
  });

  it("splits the invoice rather than refusing when the balance is short", () => {
    render(
      <InvoicePaymentSelector
        {...baseProps}
        membershipStatus="active"
        walletBalanceCents={18_417}
      />,
    );

    // $497.00 invoice, $184.17 balance → $312.83 remaining.
    expect(screen.getByText("−$184.17")).toBeInTheDocument();
    expect(screen.getByText("$312.83")).toBeInTheDocument();

    // The old dead end is gone; a partial wallet debit is not executable, so no
    // pay button may appear claiming otherwise.
    expect(
      screen.queryByText("Insufficient WF Card balance. Choose another payment method."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pay /u })).toBeNull();
  });

  it("offers the external rails for the remainder with their real state", () => {
    render(
      <InvoicePaymentSelector
        {...baseProps}
        membershipStatus="active"
        walletBalanceCents={18_417}
      />,
    );

    expect(screen.getByRole("radio", { name: /PayPal/u })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Bank Transfer/u })).toBeDisabled();
    expect(screen.getByText("Not connected yet")).toBeInTheDocument();
    expect(screen.getByText("Not configured yet")).toBeInTheDocument();
    expect(screen.queryByText(/stripe/i)).not.toBeInTheDocument();
  });
});
