import "server-only";
import { notFound, redirect } from "next/navigation";
import { uuidSchema } from "../../domain/shared";
import { getVerifiedSessionContext } from "../supabase/next-server";

/** Resolve before the account layout, whose default sign-in return is /account. */
export async function openClientInvoice(invoiceId: unknown, payment = false): Promise<never> {
  const parsed = uuidSchema.safeParse(invoiceId);
  if (!parsed.success) notFound();
  const destination = `/account/invoices/${parsed.data}${payment ? "#invoice-payment-options" : ""}`;
  if (!await getVerifiedSessionContext()) redirect(`/login?next=${encodeURIComponent(destination)}`);
  redirect(destination);
}
