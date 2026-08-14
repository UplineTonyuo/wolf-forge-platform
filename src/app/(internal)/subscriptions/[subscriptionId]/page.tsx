import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SubscriptionActions } from "../../../../components/subscriptions/subscription-actions";
import { SubscriptionDetailView, type SubscriptionInvoiceView } from "../../../../components/subscriptions/subscription-detail";
import { SubscriptionStatusBadge } from "../../../../components/subscriptions/subscription-status-badge";
import styles from "../../../../components/subscriptions/subscriptions.module.css";
import { PageFrame } from "../../../../components/ui/page-frame";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Subscription Detail" };

export default async function SubscriptionDetailPage({ params, searchParams }: { params: Promise<{ subscriptionId: string }>; searchParams: Promise<{ created?: string; saved?: string }> }) {
  const [{ subscriptionId }, query, context] = await Promise.all([params, searchParams, getInternalContext()]);
  try {
    const [detail, summaries, invoiceSummaries] = await Promise.all([
      context.services.subscriptions.get(subscriptionId),
      context.services.subscriptions.list(),
      context.services.invoices.list(),
    ]);
    const summary = summaries.find((item) => item.subscription_id === subscriptionId);
    if (!summary) notFound();
    const invoiceIds = new Set(detail.cycles.flatMap((cycle) => cycle.invoice_id ? [cycle.invoice_id] : []));
    const invoices: SubscriptionInvoiceView[] = invoiceSummaries.filter(({ invoice }) => invoiceIds.has(invoice.id)).map(({ invoice, financials }) => ({ id: invoice.id, invoiceNumber: invoice.invoice_number, status: invoice.status, presentationState: financials.presentation_state, totalCents: invoice.total_cents, currency: invoice.currency, dueAt: invoice.due_at }));

    return <PageFrame title={summary.service_name} description={<>Subscription <span className={styles.subscriptionReference}>{summary.public_ref}</span></>} action={<div className={styles.headerAction}><SubscriptionStatusBadge status={summary.status} /><SubscriptionActions subscriptionId={subscriptionId} status={summary.status} capabilities={context.user.subscriptions} /></div>}>
      {query.created ? <div className="success-banner">Subscription created from an immutable Service snapshot.</div> : null}
      {query.saved ? <div className="success-banner">A new plan version was created. Historical terms remain unchanged.</div> : null}
      <SubscriptionDetailView detail={detail} summary={summary} invoices={invoices} />
    </PageFrame>;
  } catch (error) {
    if (toClientSafeError(error).code === "NOT_FOUND") notFound();
    throw error;
  }
}
