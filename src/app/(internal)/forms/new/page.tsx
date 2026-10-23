import type { Metadata } from "next";
import { CreateForm } from "../../../../components/forms/create-form";
import { PageFrame } from "../../../../components/ui/page-frame";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "New Form" };

export default async function NewFormPage() {
  const context = await getInternalContext();
  if (!context.user.forms.manage || !await context.services.forms.workEnabled()) {
    return <PageFrame title="Form creation unavailable" description="Your current access does not permit new Form collection."><p>Authorized response history remains available.</p></PageFrame>;
  }
  const [services, folders] = await Promise.all([context.services.catalog.listActive(), context.services.catalog.listFolders()]);
  return <CreateForm services={services} folders={folders} />;
}
