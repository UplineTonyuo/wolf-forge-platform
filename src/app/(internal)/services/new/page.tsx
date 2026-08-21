import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ServiceForm } from "../../../../components/services/service-form";
import { PageFrame } from "../../../../components/ui/page-frame";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "New Service" };

export default async function NewServicePage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const parameters = await searchParams;
  const context = await getInternalContext();
  if (!context.user.services.create) redirect("/");
  const [folders, assignees] = await Promise.all([
    context.services.catalog.listFolders(),
    context.services.catalog.listAssignees(),
  ]);

  // When the flow is entered from inside a folder, that folder is locked in.
  // An unknown/unfiled id simply means no preselection (the default remains
  // Unfiled), so the URL is safe to share.
  const preselectedFolderId = parameters.folder
    ? folders.some((folder) => folder.id === parameters.folder)
      ? parameters.folder
      : undefined
    : undefined;

  return (
    <PageFrame title="New Service" description="Add a real service to the Wolf Forge catalog.">
      <ServiceForm
        mode="create"
        folders={folders}
        assignees={assignees}
        preselectedFolderId={preselectedFolderId}
      />
    </PageFrame>
  );
}
