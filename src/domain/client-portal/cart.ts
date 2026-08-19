import {
  formatStoreAmount,
  isFranchiseInABoxService,
  type StoreCadence,
} from "../services/store-projections";

/**
 * The client portal's request cart.
 *
 * Deliberately not a checkout. The database refuses client-initiated projects
 * and there is no client-facing payment surface, so inventing an order flow here
 * would be a fake. What a client can actually do today is tell their Wolf Forge
 * team what they are interested in — so the cart collects investments and hands
 * off to the existing ticket flow, which is a real, already-authorised action.
 *
 * Every field below is already public to the account through the Store card that
 * produced it. Nothing here reads a new column, and the cart never leaves the
 * browser: it is presentation state, not a record.
 */
export type CartItem = {
  id: string;
  name: string;
  /** The label the card displayed, so the cart cannot disagree with the Store. */
  priceLabel: string;
  /** The number behind that label, for cadence-separated totals. */
  amount: number;
  currency: string;
  recurring: boolean;
  cadence: StoreCadence;
  categoryName: string | null;
  /** The Store's curated preview line. Never the full inclusion list. */
  summary: string;
};

/** Beyond this a "request" stops being a conversation starter. */
export const cartLimit = 12;

export function addToCart(items: CartItem[], item: CartItem): CartItem[] {
  if (items.some((entry) => entry.id === item.id)) return items;
  if (items.length >= cartLimit) return items;
  return [...items, item];
}

export function removeFromCart(items: CartItem[], id: string): CartItem[] {
  return items.filter((entry) => entry.id !== id);
}

export function cartHas(items: CartItem[], id: string): boolean {
  return items.some((entry) => entry.id === id);
}

/**
 * Money in the cart, kept apart by billing rhythm.
 *
 * One-time, monthly and annual are deliberately never summed: "$194 + $500/mo +
 * $1,200/yr" has no single honest total, and printing one would misrepresent
 * what the client would actually commit to. Each bucket also carries its own
 * currency group for the same reason.
 */
export type CartTotal = {
  cadence: StoreCadence;
  label: string;
  currency: string;
  amount: number;
  formatted: string;
  count: number;
};

/**
 * Short form for a row chip. Deliberately the same vocabulary as the totals
 * below: a row reading "Recurring" against totals split into "Monthly
 * recurring" and "Annual recurring" leaves the client unable to tell which
 * total their item landed in.
 */
export const cadenceShortLabels: Record<StoreCadence, string> = {
  "one-time": "One-time",
  monthly: "Monthly",
  annual: "Annual",
  other: "Recurring",
};

const cadenceLabels: Record<StoreCadence, string> = {
  "one-time": "One-time",
  monthly: "Monthly recurring",
  annual: "Annual recurring",
  other: "Other recurring",
};

const cadenceSuffix: Record<StoreCadence, string> = {
  "one-time": "",
  monthly: " / month",
  annual: " / year",
  other: "",
};

/** Presentation order, so the strip never reshuffles as items are added. */
const cadenceOrder: StoreCadence[] = ["one-time", "monthly", "annual", "other"];

export function cartTotals(items: CartItem[]): CartTotal[] {
  const buckets = new Map<string, CartTotal>();

  for (const item of items) {
    const key = `${item.cadence}:${item.currency}`;
    const existing = buckets.get(key);

    if (existing) {
      existing.amount += item.amount;
      existing.count += 1;
      existing.formatted =
        formatStoreAmount(existing.amount, existing.currency) + cadenceSuffix[existing.cadence];
      continue;
    }

    buckets.set(key, {
      cadence: item.cadence,
      label: cadenceLabels[item.cadence],
      currency: item.currency,
      amount: item.amount,
      formatted: formatStoreAmount(item.amount, item.currency) + cadenceSuffix[item.cadence],
      count: 1,
    });
  }

  return [...buckets.values()].sort(
    (left, right) => cadenceOrder.indexOf(left.cadence) - cadenceOrder.indexOf(right.cadence),
  );
}

/**
 * The cart's primary call to action.
 *
 * Franchise in a Box is William's engagement. A cart holding only that names
 * him; a mixed cart stays neutral, because routing several investments at one
 * person would misdescribe who picks the conversation up. The per-investment
 * CTA on the detail page is unaffected and still says "Talk to your team".
 */
export function cartCtaLabel(items: CartItem[]): string {
  if (items.length === 0) return "Discuss these investments";
  return items.every((entry) => isFranchiseInABoxService(entry.name))
    ? "Talk to William"
    : "Discuss these investments";
}

/**
 * The draft the cart hands to the message composer.
 *
 * Plain text of exactly what the client already selected — nothing is added,
 * priced differently or committed to. It is a starting point they can edit
 * before sending, which is the whole reason the cart collects anything.
 */
export function cartDraftSubject(items: CartItem[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return `About ${items[0]!.name}`;
  return `About ${items.length} investments`;
}

export function cartDraftBody(items: CartItem[]): string {
  if (items.length === 0) return "";

  const lines = items.map(
    (item) =>
      `- ${item.name}${item.categoryName ? ` (${item.categoryName})` : ""} — ${item.priceLabel}`,
  );

  return [
    "I would like to discuss the following:",
    "",
    ...lines,
    "",
    "Could you walk me through scope, timing and the right starting point?",
  ].join("\n");
}

/**
 * Rehydrates persisted cart contents. Anything malformed is dropped rather than
 * trusted: this comes back from localStorage, which the account can edit.
 *
 * Fields added after a cart was stored are filled from what is present, so an
 * older cart still opens instead of silently emptying itself.
 */
export function parseCart(raw: string | null): CartItem[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry): entry is Record<string, unknown> => {
        if (typeof entry !== "object" || entry === null) return false;
        const candidate = entry as Record<string, unknown>;
        return (
          typeof candidate.id === "string" &&
          typeof candidate.name === "string" &&
          typeof candidate.priceLabel === "string" &&
          typeof candidate.recurring === "boolean" &&
          (candidate.categoryName === null || typeof candidate.categoryName === "string")
        );
      })
      .slice(0, cartLimit)
      .map((entry) => ({
        id: entry.id as string,
        name: entry.name as string,
        priceLabel: entry.priceLabel as string,
        amount: typeof entry.amount === "number" && Number.isFinite(entry.amount) ? entry.amount : 0,
        currency: typeof entry.currency === "string" ? entry.currency : "USD",
        recurring: entry.recurring as boolean,
        cadence: isCadence(entry.cadence)
          ? entry.cadence
          : (entry.recurring as boolean)
            ? "monthly"
            : "one-time",
        categoryName: entry.categoryName as string | null,
        summary: typeof entry.summary === "string" ? entry.summary : "",
      }));
  } catch {
    return [];
  }
}

function isCadence(value: unknown): value is StoreCadence {
  return (
    value === "one-time" || value === "monthly" || value === "annual" || value === "other"
  );
}
