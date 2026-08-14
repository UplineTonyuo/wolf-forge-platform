import { Eye, Pencil, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { InvoiceStatusBadge } from "../../../components/invoices/invoice-status-badge";
import styles from "../../../components/invoices/invoice-admin.module.css";
import { EmptyState } from "../../../components/ui/list-states";
import { PageFrame } from "../../../components/ui/page-frame";
import { formatCurrencyCents, formatDate, formatShortDate } from "../../../lib/format";
import { getInternalContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Invoices" };

const filters = [
  ["all", "All"],
  ["unpaid", "Unpaid"],
  ["paid", "Paid"],
  ["payment_pending", "Payment Pending"],
  ["refunded", "Refunded"],
  ["void", "Void"],
  ["overdue", "Overdue"],
] as const;

function numberLabel(value: number | null) {
  return value == null ? "Pending" : `WF-${String(value).padStart(4, "0")}`;
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const [{ state }, context] = await Promise.all([searchParams, getInternalContext()]);
  const activeFilter = filters.some(([value]) => value === state) ? state ?? "all" : "all";
  const invoices = await context.services.invoices.list();
  const visible = activeFilter === "all"
    ? invoices
    : invoices.filter((summary) => summary.financials.presentation_state === activeFilter);

  return (
    <PageFrame
      title="Invoices"
      action={context.user.invoices.manage ? <Link className="button-primary" href="/invoices/new"><Plus aria-hidden="true" />Add Invoice</Link> : undefined}
    >
      <div className={styles.pageEnter}>
        <nav className={styles.filterTabs} aria-label="Invoice status">
          {filters.map(([value, label]) => <Link key={value} className={activeFilter === value ? styles.activeTab : undefined} href={value === "all" ? "/invoices" : `/invoices?state=${value}`}>{label}</Link>)}
        </nav>

        {visible.length === 0 ? (
          <EmptyState title="Invoices" body={activeFilter === "all" ? "Create invoices for client Services and custom work." : `No ${filters.find(([value]) => value === activeFilter)?.[1] ?? "matching"} invoices.`} action={activeFilter === "all" && context.user.invoices.manage ? <Link className="button-primary" href="/invoices/new"><Plus aria-hidden="true" />Add Invoice</Link> : undefined} />
        ) : (
          <>
            <div className={`desktop-table-wrap ${styles.tableWrap}`}>
              <table className={styles.invoiceTable}>
                <thead><tr><th>Client</th><th>Total</th><th>Status</th><th>Created</th><th>Paid</th><th>Number</th><th>Actions</th></tr></thead>
                <tbody>{visible.map((summary) => {
                  const canEdit = context.user.invoices.manage && ["draft", "unpaid", "payment_pending"].includes(summary.invoice.status);
                  return <tr key={summary.invoice.id}><td><strong>{summary.clientName}</strong>{summary.invoice.billing_reason ? <small>{summary.invoice.billing_reason.replaceAll("_", " ")}</small> : null}</td><td>{formatCurrencyCents(summary.invoice.total_cents, summary.invoice.currency)}</td><td><InvoiceStatusBadge state={summary.financials.presentation_state} /></td><td>{formatDate(summary.invoice.created_at)}</td><td>{summary.paidAt ? formatDate(summary.paidAt) : "—"}</td><td><span className={styles.invoiceNumber}>{numberLabel(summary.invoice.invoice_number)}</span></td><td><div className={styles.rowActions}><Link href={`/invoices/${summary.invoice.id}`}><Eye aria-hidden="true" />View</Link>{canEdit ? <Link href={`/invoices/${summary.invoice.id}/edit`}><Pencil aria-hidden="true" />Edit</Link> : null}</div></td></tr>;
                })}</tbody>
              </table>
            </div>
            <div className={`mobile-record-list ${styles.mobileList}`}>{visible.map((summary) => <article className={styles.mobileCard} key={summary.invoice.id}><header><div><strong>{numberLabel(summary.invoice.invoice_number)}</strong><span>{summary.clientName}</span></div><InvoiceStatusBadge state={summary.financials.presentation_state} /></header><div className={styles.mobileAmount}>{formatCurrencyCents(summary.invoice.total_cents, summary.invoice.currency)}</div><dl><div><dt>Created</dt><dd>{formatShortDate(summary.invoice.created_at)}</dd></div><div><dt>Paid</dt><dd>{summary.paidAt ? formatShortDate(summary.paidAt) : "—"}</dd></div></dl><Link className="button-secondary" href={`/invoices/${summary.invoice.id}`}>View</Link></article>)}</div>
          </>
        )}
      </div>
    </PageFrame>
  );
}
