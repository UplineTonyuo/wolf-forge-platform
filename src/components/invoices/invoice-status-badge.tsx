import type { InvoicePresentationState } from "../../domain/invoices/schema";
import styles from "./invoice-admin.module.css";

const labels: Record<InvoicePresentationState, string> = {
  draft: "Draft",
  unpaid: "Unpaid",
  overdue: "Overdue",
  payment_pending: "Payment Pending",
  paid: "Paid",
  partially_refunded: "Partially Refunded",
  refunded: "Refunded",
  void: "Void",
};

export function InvoiceStatusBadge({ state }: { state: InvoicePresentationState }) {
  return <span className={styles.statusBadge} data-state={state}>{labels[state]}</span>;
}
