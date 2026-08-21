import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ServiceForm } from "../../../../components/services/service-form";
import { ServiceRecordActions } from "../../../../components/services/record-actions";
import { PageFrame } from "../../../../components/ui/page-frame";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { sanitizeServiceDescription } from "../../../../lib/service-description-html";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Edit Service" };

export default async function EditServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ serviceId: string }>;
  searchParams: Promise<{ created?: string; saved?: string; duplicated?: string }>;
}) {
  const [{ serviceId }, query] = await Promise.all([params, searchParams]);
  const context = await getInternalContext();
  if (!context.user.services.edit) redirect("/");
  try {
    const [service, folders, assignees] = await Promise.all([
      context.services.catalog.get(serviceId),
      context.services.catalog.listFolders(),
      context.services.catalog.listAssignees(),
    ]);
    return (
      <PageFrame title={service.name} description="Edit service configuration and Project defaults." action={<ServiceRecordActions serviceId={service.id} />}>
        {query.created ? <div className="success-banner">Service created.</div> : null}
        {query.saved ? <div className="success-banner">Service changes saved.</div> : null}
        {query.duplicated ? <div className="success-banner">Service duplicated. You are editing the new copy.</div> : null}
        <ServiceForm
          mode="edit"
          service={service}
          descriptionHtml={sanitizeServiceDescription(service.description)}
          folders={folders}
          assignees={assignees}
        />
      </PageFrame>
    );
  } catch (error) {
    if (toClientSafeError(error).code === "NOT_FOUND") notFound();
    throw error;
  }
}
