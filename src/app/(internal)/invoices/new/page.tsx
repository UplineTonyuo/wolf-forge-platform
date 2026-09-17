import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { InvoiceForm, type InvoiceServiceOption } from "../../../../components/invoices/invoice-form";
import { PageFrame } from "../../../../components/ui/page-frame";
import { parseMoneyToCents } from "../../../../lib/invoices/form-data";
import { serviceDescriptionToPlainText } from "../../../../lib/service-description-html";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Add Invoice" };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const context = await getInternalContext();
  if (!context.user.invoices.manage) forbidden();
  const { companyId } = await searchParams;
  const [companies, services, folders] = await Promise.all([
    context.services.companies.listActive(),
    context.services.catalog.listActive(),
    context.services.catalog.listFolders(),
  ]);
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
  const serviceOptions: InvoiceServiceOption[] = services.map((service) => ({
    id: service.id,
    name: service.name,
    description: serviceDescriptionToPlainText(service.description),
    priceCents: parseMoneyToCents(String(service.price), true) ?? 0,
    currency: service.currency,
    folderName: service.folder_id ? folderNames.get(service.folder_id) ?? null : null,
  }));
  return <PageFrame title="Add Invoice"><InvoiceForm mode="create" requestId={randomUUID()} companies={companies.map(({ id, name }) => ({ id, name }))} services={serviceOptions} defaultCompanyId={companyId} /></PageFrame>;
}
