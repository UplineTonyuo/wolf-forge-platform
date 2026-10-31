import { notFound, redirect } from "next/navigation";
import { uuidSchema } from "../../../../domain/shared";
import { getVerifiedSessionContext } from "../../../../lib/supabase/next-server";

export const dynamic = "force-dynamic";

export default async function InvoicePaymentLinkPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  if (!uuidSchema.safeParse(invoiceId).success) notFound();
  const destination = `/account/invoices/${invoiceId}#invoice-payment-options`;
  // Resolve before entering the account layout, whose default login return is /account.
  if (!await getVerifiedSessionContext()) redirect(`/login?next=${encodeURIComponent(destination)}`);
  redirect(destination);
}
