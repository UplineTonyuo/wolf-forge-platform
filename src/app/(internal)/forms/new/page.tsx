import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CreateForm } from "../../../../components/forms/create-form";
import { PageFrame } from "../../../../components/ui/page-frame";
import { getInternalContext } from "../../../../lib/supabase/next-server";
import { loadReviewedIntakeTemplates } from "../../../../lib/forms/reviewed-intake-templates";

export const metadata: Metadata = { title: "New Form" };

export default async function NewFormPage({ searchParams }: { searchParams: Promise<{ template?: string | string[] }> }) {
  const context = await getInternalContext();
  if (!context.user.forms.manage || !await context.services.forms.workEnabled()) {
    return <PageFrame title="Form creation unavailable" description="Your current access does not permit new Form collection."><p>Authorized response history remains available.</p></PageFrame>;
  }
  const [services, folders] = await Promise.all([context.services.catalog.listActive(), context.services.catalog.listFolders()]);
  const { template } = await searchParams;
  const reviewed = await loadReviewedIntakeTemplates(services, typeof template === "string" ? template : undefined);
  if (template !== undefined && !reviewed.selected) notFound();
  return <CreateForm key={reviewed.selected?.file ?? "blank"} services={services} folders={folders} reviewedTemplates={reviewed.options} reviewedTemplate={reviewed.selected} />;
}
