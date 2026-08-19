import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClientInvoicesView } from "../../../components/account/billing/client-invoices";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { readClientInvoices } from "../../../lib/supabase/client-portal-data";
import { getClientContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Invoices" };

export default async function ClientInvoicesPage() {
  const { services } = await getClientContext();

  let denied = false;
  let loadError: string | null = null;
  let invoices = null;

  try {
    await services.permissions.requireModuleAccess("portal_invoices");
    invoices = await readClientInvoices();
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "PERMISSION_DENIED") denied = true;
    else loadError = safe.message || "Invoices could not be loaded.";
  }

  if (denied) redirect("/account");

  if (loadError) {
    return (
      <div className="portal-page">
        <header className="portal-page-head">
          <span className="portal-eyebrow">Billing</span>
          <h1>Invoices</h1>
        </header>
        <p className="portal-empty">{loadError}</p>
      </div>
    );
  }

  return <ClientInvoicesView invoices={invoices ?? []} />;
}
