/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../app/actions/wf-card", () => ({
  payInvoiceWithWfCardAction: vi.fn(),
}));

import { InvoicePaymentSelector } from "../components/invoices/invoice-payment-selector";

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

const baseProps = {
  invoiceId: "11111111-1111-4111-8111-111111111111",
  holderName: "Acme Forge",
  invoiceBalanceCents: 49_700,
  currency: "USD",
  walletBalanceCents: 68_417,
  membershipPriceCents: 25_900,
  membershipCurrency: "USD",
  collectible: true,
};

afterEach(cleanup);

describe("WF Card invoice payment selector", () => {
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
    expect(screen.getByRole("button", { name: "Pay $497.00 with WF Card" })).toBeEnabled();
  });

  it("keeps WF Card first and visible for non-members with a locked treatment", () => {
    const { container } = render(
      <InvoicePaymentSelector {...baseProps} membershipStatus="inactive" />,
    );

    expect(container.querySelector(".wolf-wallet-final")).toBeInTheDocument();
    expect(screen.getByText("Members only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock WF Card" })).toBeEnabled();
  });

  it("opens an accessible $259 membership modal without activating membership", () => {
    render(<InvoicePaymentSelector {...baseProps} membershipStatus="inactive" />);
    fireEvent.click(screen.getByRole("button", { name: "Unlock WF Card" }));

    const dialog = screen.getByRole("dialog", { name: "Wolf Forge Membership" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("$259")).toBeInTheDocument();
    expect(screen.getByText("Cashback opportunities")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Get WF Card — $259" }));
    expect(screen.getByText(/secure membership checkout requires the upcoming payment-provider integration/i)).toBeInTheDocument();
    expect(screen.getByText(/membership has not been activated/i)).toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeInTheDocument();
  });

  it("disables full wallet payment when balance is insufficient", () => {
    render(
      <InvoicePaymentSelector
        {...baseProps}
        membershipStatus="active"
        walletBalanceCents={18_417}
      />,
    );

    expect(screen.getByText("Insufficient WF Card balance. Choose another payment method.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay $497.00 with WF Card" })).toBeDisabled();
  });

  it("exposes future methods only as an unavailable provider boundary", () => {
    render(<InvoicePaymentSelector {...baseProps} membershipStatus="active" />);
    fireEvent.click(screen.getByRole("button", { name: "Other payment methods" }));
    expect(screen.getByText("No additional online methods are enabled yet.")).toBeInTheDocument();
    expect(screen.queryByText(/stripe/i)).not.toBeInTheDocument();
  });
});
