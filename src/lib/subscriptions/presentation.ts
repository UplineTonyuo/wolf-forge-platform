import type { SubscriptionEvent } from "../../domain/subscriptions/schema";

export const subscriptionStatusLabels = {
  active: "Active",
  past_due: "Past Due",
  paused: "Paused",
  pending_cancellation: "Pending Cancellation",
  canceled: "Canceled",
} as const;

export const subscriptionHealthLabels = {
  ...subscriptionStatusLabels,
  stalled: "Stalled",
  requires_attention: "Requires Attention",
} as const;

export function formatSubscriptionInterval(unit: string, count: number): string {
  if (count === 1) {
    const singular: Record<string, string> = {
      day: "Daily",
      week: "Weekly",
      month: "Monthly",
      year: "Yearly",
    };
    return singular[unit] ?? `Every ${unit}`;
  }
  return `Every ${count} ${unit}${count === 1 ? "" : "s"}`;
}

export function humanizeSubscriptionValue(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}

export const subscriptionEventLabels: Record<SubscriptionEvent["event_type"], string> = {
  created: "Subscription created",
  cycle_scheduled: "Billing cycle scheduled",
  invoice_generated: "Invoice generated",
  payment_settled: "Payment settled",
  payment_failed: "Payment failed",
  past_due: "Marked past due",
  recovered: "Billing recovered",
  paused: "Subscription paused",
  resumed: "Subscription resumed",
  cancellation_scheduled: "Cancellation scheduled",
  cancellation_removed: "Scheduled cancellation removed",
  canceled: "Subscription canceled",
  terms_changed: "Plan terms changed",
  invoice_invalidated: "Invoice requires attention",
  fulfillment_pending: "Fulfillment pending",
};

export function invoiceDisplayNumber(value: number | null): string {
  return value == null ? "Invoice" : `WF-${String(value).padStart(4, "0")}`;
}
