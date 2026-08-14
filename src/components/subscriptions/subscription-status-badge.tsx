import type { SubscriptionSummary } from "../../domain/subscriptions/schema";
import { subscriptionHealthLabels, subscriptionStatusLabels } from "../../lib/subscriptions/presentation";
import styles from "./subscriptions.module.css";

export function SubscriptionStatusBadge({ status }: { status: SubscriptionSummary["status"] }) {
  return <span className={styles.statusBadge} data-state={status}>{subscriptionStatusLabels[status]}</span>;
}

export function SubscriptionHealthBadge({ health, status }: Pick<SubscriptionSummary, "health" | "status">) {
  if (health === status) return <span className={styles.healthClear}>Clear</span>;
  return <span className={styles.healthBadge} data-health={health}>{subscriptionHealthLabels[health]}</span>;
}
