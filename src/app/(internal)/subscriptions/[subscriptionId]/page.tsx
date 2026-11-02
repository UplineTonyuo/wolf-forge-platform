import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { RouteTransitionLink } from "../../../../components/shell/route-transition";
import { forbidden, notFound } from "next/navigation";
import { SubscriptionHistoryBoundary } from "../../../../components/subscriptions/subscription-history-boundary";
import { SubscriptionActions } from "../../../../components/subscriptions/subscription-actions";
import { SubscriptionDetailView, type SubscriptionInvoiceView } from "../../../../components/subscriptions/subscription-detail";
import { SubscriptionStatusBadge } from "../../../../components/subscriptions/subscription-status-badge";
import { SuccessToast } from "../../../../components/ui/success-toast";
import styles from "../../../../components/subscriptions/subscriptions.module.css";
import { PageFrame } from "../../../../components/ui/page-frame";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { formatCurrencyCents } from "../../../../lib/format";
import { formatSubscriptionInterval } from "../../../../lib/subscriptions/presentation";
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

    return <SubscriptionHistoryBoundary key={summary.status} states={[`${subscriptionId}:${summary.status}`]} ids={[subscriptionId]} audience="internal"><PageFrame className={styles.detailPage} title={summary.service_name} description={<span className={styles.detailHeading}><span>{summary.company_name}</span><span><strong>{formatCurrencyCents(summary.amount_cents, summary.currency)}</strong> / {summary.interval_count === 1 ? summary.interval_unit : `${summary.interval_count} ${summary.interval_unit}s`} · {formatSubscriptionInterval(summary.interval_unit, summary.interval_count)}</span></span>} action={<div className={styles.headerAction}><SubscriptionStatusBadge status={summary.status} /><SubscriptionActions subscriptionId={subscriptionId} status={summary.status} capabilities={context.user.subscriptions} /></div>}>
      <RouteTransitionLink className={styles.back} href="/subscriptions"><ArrowLeft size={16} aria-hidden="true" />Back to subscriptions</RouteTransitionLink>
      {query.created ? <SuccessToast title="Subscription created." detail="The current plan uses a Service snapshot." /> : null}
      {query.saved ? <SuccessToast title="New plan version created." detail="Historical terms remain unchanged." /> : null}
      <SubscriptionDetailView detail={detail} summary={summary} invoices={invoices} />
    </PageFrame></SubscriptionHistoryBoundary>;
  } catch (error) {
    if (toClientSafeError(error).code === "NOT_FOUND") notFound();
    if (toClientSafeError(error).code === "PERMISSION_DENIED") forbidden();
    throw error;
  }
}
