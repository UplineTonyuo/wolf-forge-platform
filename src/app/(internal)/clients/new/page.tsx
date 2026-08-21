import type { Metadata } from "next";
import { CreateClientForm } from "../../../../components/forms/create-client-form";
import { PageFrame } from "../../../../components/ui/page-frame";
import { redirect } from "next/navigation";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = {
  title: "Add account",
};

export default async function NewClientPage() {
  const context = await getInternalContext();
  if (!context.user.clients.create) redirect("/");

  return (
    <PageFrame
      title="Add account"
      description="Create a client account and primary contact."
      narrow
    >
      <CreateClientForm />
    </PageFrame>
  );
}
