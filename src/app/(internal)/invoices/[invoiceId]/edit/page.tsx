import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";
import { InvoiceForm, type InvoiceFormInitial, type InvoiceServiceOption } from "../../../../../components/invoices/invoice-form";
import { PageFrame } from "../../../../../components/ui/page-frame";
import { toClientSafeError } from "../../../../../lib/errors/application-error";
import { parseMoneyToCents } from "../../../../../lib/invoices/form-data";
import { serviceDescriptionToPlainText } from "../../../../../lib/service-description-html";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Edit Invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const [{ invoiceId }, context] = await Promise.all([params, getInternalContext()]);
  if (!context.user.invoices.manage) forbidden();
  try {
    const [detail, companies, services, folders] = await Promise.all([
      context.services.invoices.get(invoiceId),
      context.services.companies.listActive(),
      context.services.catalog.listActive(),
      context.services.catalog.listFolders(),
    ]);
    if (!["draft", "unpaid", "payment_pending"].includes(detail.invoice.status)) notFound();
    const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
    const serviceOptions: InvoiceServiceOption[] = services.map((service) => ({
      id: service.id,
      name: service.name,
      description: serviceDescriptionToPlainText(service.description),
      priceCents: parseMoneyToCents(String(service.price), true) ?? 0,
      currency: service.currency,
      folderId: service.folder_id,
      folderName: service.folder_id ? folderNames.get(service.folder_id) ?? null : null,
    }));
    const initial: InvoiceFormInitial = {
      id: detail.invoice.id,
      status: detail.invoice.status as InvoiceFormInitial["status"],
      companyId: detail.invoice.company_id,
      currency: detail.invoice.currency,
      billingReason: detail.invoice.billing_reason,
      dueDate: detail.invoice.due_at?.slice(0, 10) ?? "",
      taxTotalCents: detail.invoice.tax_total_cents,
      items: detail.items.map((item) => ({ id: item.id, serviceId: item.service_id, name: item.name, description: serviceDescriptionToPlainText(item.description), quantity: item.quantity, unitPriceCents: item.unit_price_cents, unitDiscountCents: item.unit_discount_cents, taxable: item.is_taxable })),
    };
    return <PageFrame title={detail.invoice.status === "draft" ? "Edit Invoice Draft" : `Edit Invoice #WF-${String(detail.invoice.invoice_number).padStart(4, "0")}`}><InvoiceForm mode="edit" requestId={randomUUID()} companies={companies.map(({ id, name }) => ({ id, name }))} services={serviceOptions} folders={folders} initial={initial} /></PageFrame>;
  } catch (error) {
    if (toClientSafeError(error).code === "NOT_FOUND") notFound();
    throw error;
  }
}
