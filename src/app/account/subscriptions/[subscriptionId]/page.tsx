import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClientSubscriptionDetail } from "../../../../components/subscriptions/client-subscriptions";
import type { SubscriptionInvoiceView } from "../../../../components/subscriptions/subscription-detail";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { getClientContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "My Subscription" };

export default async function ClientSubscriptionDetailPage({ params }: { params: Promise<{ subscriptionId: string }> }) {
  const [{ subscriptionId }, context] = await Promise.all([params, getClientContext()]);
  try {
    const [detail, summaries, invoiceSummaries] = await Promise.all([
      context.services.subscriptions.get(subscriptionId),
      context.services.subscriptions.list(),
      context.services.invoices.listForClient(),
    ]);
    const summary = summaries.find((item) => item.subscription_id === subscriptionId);
    if (!summary) notFound();
    const invoiceIds = new Set(detail.cycles.flatMap((cycle) => cycle.invoice_id ? [cycle.invoice_id] : []));
    const invoices: SubscriptionInvoiceView[] = invoiceSummaries.filter(({ invoice }) => invoiceIds.has(invoice.id)).map(({ invoice, financials }) => ({ id: invoice.id, invoiceNumber: invoice.invoice_number, status: invoice.status, presentationState: financials.presentation_state, totalCents: invoice.total_cents, currency: invoice.currency, dueAt: invoice.due_at }));
    return <ClientSubscriptionDetail detail={detail} summary={summary} invoices={invoices} />;
  } catch (error) {
    if (toClientSafeError(error).code === "NOT_FOUND") notFound();
    throw error;
  }
}
