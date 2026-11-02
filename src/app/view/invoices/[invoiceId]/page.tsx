import { openClientInvoice } from "../../../../lib/invoices/open-client-invoice";

export const dynamic = "force-dynamic";

export default async function InvoiceViewLinkPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  return openClientInvoice((await params).invoiceId);
}
