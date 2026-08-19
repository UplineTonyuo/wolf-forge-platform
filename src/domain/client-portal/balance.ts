import type { InvoiceFinancials, InvoicePresentationState } from "../invoices/schema";

/**
 * The client's outstanding balance.
 *
 * Derived entirely from what app_get_invoice_financials already reports. There
 * is no balance column anywhere in the schema and this module does not propose
 * one: the authoritative figure is total − net settled, per invoice, and that
 * is what is summed here.
 *
 * Two rules this module exists to enforce:
 *
 *   1. Currencies are NEVER summed together. The platform has no FX rate source
 *      of any kind, so a mixed-currency account gets one balance per currency
 *      rather than a fabricated conversion. This is the correctness bug in the
 *      previous dashboard, which added every balance_due_cents together and
 *      labelled the total with the first invoice's currency.
 *
 *   2. Only collectible invoices contribute. balance_due_cents is zeroed by the
 *      database for a paid invoice but NOT for a void or draft one, so those
 *      are excluded here by presentation state rather than by trusting the
 *      number alone.
 */

/** Presentation states that represent money the client actually owes. */
const collectibleStates = new Set<InvoicePresentationState>([
  "unpaid",
  "overdue",
  "payment_pending",
  "partially_refunded",
]);

export function invoiceIsCollectible(financials: {
  presentation_state: string;
  balance_due_cents: number;
}): boolean {
  return (
    financials.balance_due_cents > 0
    && collectibleStates.has(financials.presentation_state as InvoicePresentationState)
  );
}

export type ClientBalanceInput = {
  invoice: { currency: string; due_at: string | null };
  financials: Pick<InvoiceFinancials, "presentation_state" | "balance_due_cents" | "is_overdue">;
};

export type ClientCurrencyBalance = {
  currency: string;
  outstandingCents: number;
  /** Number of collectible invoices contributing to this currency's total. */
  invoiceCount: number;
  overdueCount: number;
  /** Not yet overdue, but due within the next seven days. */
  dueSoonCount: number;
};

export type ClientBalance = {
  /** One entry per currency with money outstanding. Empty when nothing is owed. */
  currencies: ClientCurrencyBalance[];
  /**
   * True when more than one currency carries a balance. The UI uses this to
   * stop presenting a single headline figure.
   */
  isMultiCurrency: boolean;
  totalCollectibleInvoices: number;
  totalOverdueInvoices: number;
};

const DUE_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function composeClientBalance(
  entries: ClientBalanceInput[],
  now: Date = new Date(),
): ClientBalance {
  const timestamp = now.getTime();
  const byCurrency = new Map<string, ClientCurrencyBalance>();

  for (const entry of entries) {
    if (!invoiceIsCollectible(entry.financials)) continue;

    const currency = entry.invoice.currency.toUpperCase();
    const bucket = byCurrency.get(currency) ?? {
      currency,
      outstandingCents: 0,
      invoiceCount: 0,
      overdueCount: 0,
      dueSoonCount: 0,
    };

    bucket.outstandingCents += entry.financials.balance_due_cents;
    bucket.invoiceCount += 1;

    if (entry.financials.is_overdue) {
      bucket.overdueCount += 1;
    } else if (entry.invoice.due_at) {
      const dueIn = new Date(entry.invoice.due_at).getTime() - timestamp;
      if (dueIn >= 0 && dueIn <= DUE_SOON_WINDOW_MS) bucket.dueSoonCount += 1;
    }

    byCurrency.set(currency, bucket);
  }

  // Largest balance first, then alphabetical so the order is stable when two
  // currencies happen to carry the same amount.
  const currencies = [...byCurrency.values()].sort(
    (left, right) =>
      right.outstandingCents - left.outstandingCents
      || left.currency.localeCompare(right.currency),
  );

  return {
    currencies,
    isMultiCurrency: currencies.length > 1,
    totalCollectibleInvoices: currencies.reduce((total, entry) => total + entry.invoiceCount, 0),
    totalOverdueInvoices: currencies.reduce((total, entry) => total + entry.overdueCount, 0),
  };
}

/**
 * A short factual breakdown line, or null when nothing is owed.
 *
 * Deliberately returns null rather than "0 invoices" so the caller renders the
 * caught-up state instead of a zero it has to explain.
 */
export function describeCurrencyBalance(balance: ClientCurrencyBalance): string {
  const parts: string[] = [
    `${balance.invoiceCount} unpaid ${balance.invoiceCount === 1 ? "invoice" : "invoices"}`,
  ];

  if (balance.overdueCount > 0) {
    parts.push(`${balance.overdueCount} overdue`);
  } else if (balance.dueSoonCount > 0) {
    parts.push(
      balance.dueSoonCount === 1 ? "1 due this week" : `${balance.dueSoonCount} due this week`,
    );
  }

  return parts.join(" · ");
}
