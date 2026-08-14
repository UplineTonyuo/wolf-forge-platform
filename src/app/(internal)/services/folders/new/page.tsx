import type { Metadata } from "next";
import { FolderForm } from "../../../../../components/services/folder-form";
import { PageFrame } from "../../../../../components/ui/page-frame";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "New Service Folder" };

export default async function NewServiceFolderPage() {
  const context = await getInternalContext();
  const folders = await context.services.catalog.listFolders();
  return <PageFrame title="New Folder" description="Create a catalog folder for related services." narrow><FolderForm folders={folders} /></PageFrame>;
}
