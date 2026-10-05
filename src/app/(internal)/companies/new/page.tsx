import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CreateCompanyForm } from "../../../../components/forms/create-company-form";
import { PageFrame } from "../../../../components/ui/page-frame";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = {
  title: "Add Company",
};

export default async function AddCompanyPage() {
  const context = await getInternalContext();
  await context.services.permissions.requireModuleAccess("clients");

  if (!context.user.clients.create) {
    redirect("/");
  }

  return (
    <PageFrame
      title="Add Company"
      description="Create a company record without creating a client login."
      narrow
    >
      <CreateCompanyForm />
    </PageFrame>
  );
}
