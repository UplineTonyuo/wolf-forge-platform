import type { OrderStatus } from "../../domain/orders/schema";

const labels: Record<OrderStatus, string> = {
  pending: "Pending",
  submitted: "Submitted",
  working: "Working",
  waiting_reply: "Waiting on client",
  pending_update: "Needs update",
  complete: "Complete",
  canceled: "Canceled",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`status-badge status-${status}`}>{labels[status]}</span>;
}
