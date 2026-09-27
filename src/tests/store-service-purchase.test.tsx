/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveStorePurchaseOffer,
  storePurchaseBlockedLabel,
  toPriceCents,
  type StorePurchaseOffer,
} from "../domain/store/purchase";
import type { StoreServiceView } from "../domain/services/store-projections";
import { resetCartForTests } from "../components/account/cart/cart-store";

const push = vi.fn();
const refresh = vi.fn();

type ActionInput = { serviceId: string; requestId: string };

const purchaseServiceWithBalanceAction = vi.fn<
  (input: ActionInput) => Promise<Record<string, unknown>>
>();

const recordStoreInterestAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

// The detail page's Talk to team and back links are plain anchors here; these
// tests assert presence and behaviour, not routing.
vi.mock("next/link", () => ({
  default: (props: { href: string; children?: ReactNode; [key: string]: unknown }) => (
    <a {...props} />
  ),
}));

vi.mock("../app/actions/store-purchase", () => ({
  purchaseServiceWithBalanceAction: (input: ActionInput) =>
    purchaseServiceWithBalanceAction(input),
}));

vi.mock("../app/actions/store-interest", () => ({
  recordStoreInterestAction: (input: unknown) => recordStoreInterestAction(input),
}));

const { PurchaseWithBalance } = await import(
  "../components/account/store/purchase-with-balance"
);
const { StoreServiceDetail } = await import(
  "../components/account/store/store-service-detail"
);

afterEach(cleanup);
beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  purchaseServiceWithBalanceAction.mockReset();
  purchaseServiceWithBalanceAction.mockResolvedValue({
    ok: true,
    orderId: "o-1",
    orderNumber: 123,
    amountCents: 149500,
    currency: "USD",
    walletBalanceCents: 60500,
    serviceName: "Platinum SEO Success Blueprint",
    replayed: false,
  });

  if (!("randomUUID" in globalThis.crypto)) {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: () => "11111111-1111-4111-8111-111111111111",
      configurable: true,
    });
  }
});

function service(overrides: Partial<StoreServiceView> = {}): StoreServiceView {
  return {
    id: "s-1",
    name: "Platinum SEO Success Blueprint",
    folderId: null,
    priceLabel: "$1,495",
    amount: 1495,
    currency: "USD",
    recurring: false,
    cadence: "one-time",
    recurringLabel: null,
    imageUrl: null,
    descriptionHtml: "",
    summary: "",
    ...overrides,
  };
}

function offer(overrides: Partial<Extract<StorePurchaseOffer, { purchasable: true }>> = {}) {
  return {
    purchasable: true as const,
    priceCents: 149500,
    currency: "USD",
    balanceCents: 210000,
    balanceAfterCents: 60500,
    ...overrides,
  };
}

// =============================================================================
// The offer is a projection of the database's refusals
// =============================================================================

describe("resolveStorePurchaseOffer", () => {
  const base = {
    balanceCents: 210000,
    walletCurrency: "USD",
  };

  it("offers a purchase and computes what is left", () => {
    const result = resolveStorePurchaseOffer({ service: service(), ...base });
    expect(result.purchasable).toBe(true);
    if (!result.purchasable) return;
    expect(result.priceCents).toBe(149500);
    expect(result.balanceAfterCents).toBe(60500);
  });

  it("never consults WF Card membership — a funded client gets the offer", () => {
    // The input has no membership field at all. Purchasability is decided by the
    // service and the balance alone; there is no membership branch to require.
    const result = resolveStorePurchaseOffer({ service: service(), ...base });
    expect(result.purchasable).toBe(true);
  });

  it("refuses a recurring service rather than mis-selling a subscription", () => {
    const result = resolveStorePurchaseOffer({
      service: service({ recurring: true }),
      ...base,
    });
    expect(result).toMatchObject({ purchasable: false, reason: "recurring" });
  });

  it("refuses an unpriced service", () => {
    const result = resolveStorePurchaseOffer({ service: service({ amount: 0 }), ...base });
    expect(result).toMatchObject({ purchasable: false, reason: "unpriced" });
  });

  it("reports the shortfall when the balance is short", () => {
    const result = resolveStorePurchaseOffer({ service: service(), ...base, balanceCents: 50000 });
    expect(result).toMatchObject({
      purchasable: false,
      reason: "insufficient_balance",
      shortfallCents: 99500,
    });
  });

  it("never guesses a balance it could not read", () => {
    const result = resolveStorePurchaseOffer({
      service: service(),
      ...base,
      balanceCents: null,
      walletCurrency: null,
    });
    expect(result).toMatchObject({
      purchasable: false,
      reason: "balance_unknown",
      balanceCents: null,
    });
  });

  it("refuses to spend across currencies", () => {
    const result = resolveStorePurchaseOffer({
      service: service(),
      ...base,
      walletCurrency: "EUR",
    });
    expect(result).toMatchObject({ purchasable: false, reason: "balance_unknown" });
  });

  it("converts catalogue decimals to whole cents", () => {
    expect(toPriceCents(1495)).toBe(149500);
    expect(toPriceCents(99.99)).toBe(9999);
    expect(toPriceCents(0.1 + 0.2)).toBe(30);
  });

  it("gives every refusal a sentence a client can act on", () => {
    for (const reason of [
      "recurring",
      "unpriced",
      "insufficient_balance",
      "balance_unknown",
    ] as const) {
      expect(storePurchaseBlockedLabel(reason).length).toBeGreaterThan(10);
    }
  });
});

// =============================================================================
// The control
// =============================================================================

describe("PurchaseWithBalance", () => {
  function renderControl(over?: StorePurchaseOffer) {
    return render(
      <PurchaseWithBalance
        serviceId="s-1"
        serviceName="Platinum SEO Success Blueprint"
        offer={over ?? offer()}
      />,
    );
  }

  it("shows the purchase CTA and the current balance", () => {
    renderControl();
    expect(
      screen.getByRole("button", { name: /Purchase with Wolf Forge Balance/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Balance \$2,100\.00/)).toBeInTheDocument();
  });

  it("shows no purchase control at all when the account cannot buy", () => {
    renderControl({
      purchasable: false,
      reason: "insufficient_balance",
      priceCents: 149500,
      currency: "USD",
      balanceCents: 50000,
      shortfallCents: 99500,
    });

    expect(
      screen.queryByRole("button", { name: /Purchase with Wolf Forge Balance/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/does not cover this yet/i)).toBeInTheDocument();
    expect(screen.getByText("$500.00")).toBeInTheDocument();
    expect(screen.getByText("$1,495.00")).toBeInTheDocument();
  });

  it("confirms with the real service, amount, method and resulting balance", () => {
    renderControl();
    fireEvent.click(screen.getByRole("button", { name: /Purchase with Wolf Forge Balance/i }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Purchase Platinum SEO Success Blueprint?");
    expect(dialog).toHaveTextContent("$1,495.00");
    expect(dialog).toHaveTextContent("Wolf Forge Balance");
    expect(dialog).toHaveTextContent("$2,100.00");
    expect(dialog).toHaveTextContent("$605.00");
  });

  it("moves no money until the client confirms", () => {
    renderControl();
    fireEvent.click(screen.getByRole("button", { name: /Purchase with Wolf Forge Balance/i }));
    expect(purchaseServiceWithBalanceAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(purchaseServiceWithBalanceAction).not.toHaveBeenCalled();
  });

  it("calls the purchase exactly once however many times Confirm is pressed", async () => {
    let release: (value: Record<string, unknown>) => void = () => {};
    purchaseServiceWithBalanceAction.mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );

    renderControl();
    fireEvent.click(screen.getByRole("button", { name: /Purchase with Wolf Forge Balance/i }));

    const confirm = screen.getByRole("button", { name: /Confirm purchase/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(purchaseServiceWithBalanceAction).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Processing/ })).toBeDisabled(),
    );

    release({
      ok: true,
      orderId: "o-1", orderNumber: 1,
      amountCents: 149500, currency: "USD", walletBalanceCents: 60500,
      serviceName: "Platinum SEO Success Blueprint", replayed: false,
    });
  });

  it("sends only stable identifiers — never a price, balance or company", async () => {
    renderControl();
    fireEvent.click(screen.getByRole("button", { name: /Purchase with Wolf Forge Balance/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm purchase/i }));

    await waitFor(() => expect(purchaseServiceWithBalanceAction).toHaveBeenCalled());
    const payload = purchaseServiceWithBalanceAction.mock.calls[0]?.[0];
    expect(Object.keys(payload ?? {}).sort()).toEqual(["requestId", "serviceId"]);
    expect(payload?.serviceId).toBe("s-1");
    expect(payload?.requestId).toBeTruthy();
  });

  it("reuses one request id across retries of the same decision", async () => {
    purchaseServiceWithBalanceAction.mockResolvedValue({
      ok: false, code: "PURCHASE_FAILED", error: "Network unavailable.",
    });

    renderControl();
    fireEvent.click(screen.getByRole("button", { name: /Purchase with Wolf Forge Balance/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm purchase/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Confirm purchase/i }));
    await waitFor(() => expect(purchaseServiceWithBalanceAction).toHaveBeenCalledTimes(2));

    const first = purchaseServiceWithBalanceAction.mock.calls[0]?.[0]?.requestId;
    const second = purchaseServiceWithBalanceAction.mock.calls[1]?.[0]?.requestId;
    expect(first).toBe(second);
  });

  it("shows the success face and then leaves for the client's projects", async () => {
    vi.useFakeTimers();
    try {
      renderControl();
      fireEvent.click(screen.getByRole("button", { name: /Purchase with Wolf Forge Balance/i }));
      fireEvent.click(screen.getByRole("button", { name: /Confirm purchase/i }));

      await vi.waitFor(() => expect(screen.getByText("Purchase confirmed")).toBeInTheDocument());
      expect(screen.getByText(/has been added to your Wolf Forge services/)).toBeInTheDocument();
      expect(screen.getByText(/team has been notified/)).toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2000);
      expect(push).toHaveBeenCalledWith("/account/projects");
      expect(refresh).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays in the Store and shows no success face when the purchase fails", async () => {
    purchaseServiceWithBalanceAction.mockResolvedValue({
      ok: false,
      code: "INSUFFICIENT_BALANCE",
      error: "Your Wolf Forge Balance no longer covers this investment.",
    });

    renderControl();
    fireEvent.click(screen.getByRole("button", { name: /Purchase with Wolf Forge Balance/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm purchase/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/no longer covers/),
    );

    expect(screen.queryByText("Purchase confirmed")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("re-enables Confirm after a failure so the client can retry", async () => {
    purchaseServiceWithBalanceAction.mockResolvedValue({
      ok: false, code: "PURCHASE_FAILED", error: "Something went wrong.",
    });

    renderControl();
    fireEvent.click(screen.getByRole("button", { name: /Purchase with Wolf Forge Balance/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm purchase/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Confirm purchase/i })).not.toBeDisabled(),
    );
  });
});

// =============================================================================
// The detail page keeps all three paths, with no WF Card membership anywhere
// =============================================================================

describe("StoreServiceDetail", () => {
  beforeEach(() => {
    resetCartForTests();
    recordStoreInterestAction.mockReset();
    recordStoreInterestAction.mockResolvedValue({ ok: true });
  });

  function renderDetail(purchaseOffer: StorePurchaseOffer | null = null) {
    return render(
      <StoreServiceDetail
        service={service()}
        folderName="On-page SEO"
        backHref="/account/store"
        purchaseOffer={purchaseOffer ?? offer()}
      />,
    );
  }

  it("offers Purchase, Add to Cart and Talk to Team with no membership signal", () => {
    renderDetail();

    // The purchase CTA is present purely from service + balance. No membership
    // row, status or prop is consulted anywhere in this tree.
    expect(
      screen.getByRole("button", { name: /Purchase with Wolf Forge Balance/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add to cart/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Talk to your team/i })).toBeInTheDocument();
  });

  it("still adds the investment to the cart", () => {
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: /Add to cart/i }));
    expect(screen.getByRole("button", { name: /In your cart/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Purchase with Wolf Forge Balance/i })).toBeInTheDocument();
  });

  it("keeps Talk to Team as the no-purchase route", () => {
    render(
      <StoreServiceDetail
        service={service()}
        folderName="On-page SEO"
        backHref="/account/store"
        purchaseOffer={null}
      />,
    );

    expect(screen.getByRole("link", { name: /Talk to your team/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Purchase with Wolf Forge Balance/i }),
    ).not.toBeInTheDocument();
  });
});
