import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FolderForm } from "../../../../../components/services/folder-form";
import { FolderSubscriptionControl } from "../../../../../components/services/folder-subscription-control";
import { folderSubscriptionSummary } from "../../../../../components/services/folder-subscription-summary";
import { FolderRecordActions } from "../../../../../components/services/record-actions";
import { PageFrame } from "../../../../../components/ui/page-frame";
import { toClientSafeError } from "../../../../../lib/errors/application-error";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Edit Service Folder" };

export default async function EditServiceFolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ folderId: string }>;
  searchParams: Promise<{ saved?: string; subscriptions?: string }>;
}) {
  const [{ folderId }, query] = await Promise.all([params, searchParams]);
  const context = await getInternalContext();
  if (!context.user.services.edit) redirect("/");
  try {
    const [folder, folders, services] = await Promise.all([
      context.services.catalog.getFolder(folderId),
      context.services.catalog.listFolders(),
      context.services.catalog.listCatalog(),
    ]);
    const folderServices = services.filter((service) => service.folder_id === folder.id);
    const summary = folderSubscriptionSummary(folderServices);
    return (
      <PageFrame title={folder.name} description="Edit this service folder and its nesting." action={<FolderRecordActions folderId={folder.id} />} narrow>
        {query.saved ? <div className="success-banner">Folder changes saved.</div> : null}
        {query.subscriptions ? <div className="success-banner">Subscription availability updated.</div> : null}
        <FolderForm folder={folder} folders={folders} />
        {/* Keyed on the derived counts so a completed bulk change remounts it with the dialog closed. */}
        <FolderSubscriptionControl
          key={`${summary.eligible}/${summary.total}`}
          folderId={folder.id}
          folderName={folder.name}
          services={folderServices}
        />
      </PageFrame>
    );
  } catch (error) {
    if (toClientSafeError(error).code === "NOT_FOUND") notFound();
    throw error;
  }
}
