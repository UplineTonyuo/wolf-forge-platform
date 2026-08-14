import type { Metadata } from "next";
import { ServiceForm } from "../../../../components/services/service-form";
import { PageFrame } from "../../../../components/ui/page-frame";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "New Service" };

export default async function NewServicePage() {
  const context = await getInternalContext();
  const [folders, assignees] = await Promise.all([
    context.services.catalog.listFolders(),
    context.services.catalog.listAssignees(),
  ]);
  return (
    <PageFrame title="New Service" description="Add a real service to the Wolf Forge catalog.">
      <ServiceForm mode="create" folders={folders} assignees={assignees} />
    </PageFrame>
  );
}
