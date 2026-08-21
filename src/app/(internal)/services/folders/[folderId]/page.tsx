import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FolderForm } from "../../../../../components/services/folder-form";
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
  searchParams: Promise<{ saved?: string }>;
}) {
  const [{ folderId }, query] = await Promise.all([params, searchParams]);
  const context = await getInternalContext();
  if (!context.user.services.edit) redirect("/");
  try {
    const [folder, folders] = await Promise.all([
      context.services.catalog.getFolder(folderId),
      context.services.catalog.listFolders(),
    ]);
    return (
      <PageFrame title={folder.name} description="Edit this service folder and its nesting." action={<FolderRecordActions folderId={folder.id} />} narrow>
        {query.saved ? <div className="success-banner">Folder changes saved.</div> : null}
        <FolderForm folder={folder} folders={folders} />
      </PageFrame>
    );
  } catch (error) {
    if (toClientSafeError(error).code === "NOT_FOUND") notFound();
    throw error;
  }
}
