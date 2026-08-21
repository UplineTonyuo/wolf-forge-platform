import { redirect } from "next/navigation";
import { ProvisioningPlaceholder } from "../../../../components/accounts/provisioning-placeholder";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export default async function AddCompanyPage() {
  const context = await getInternalContext();
  await context.services.permissions.requireModuleAccess("clients");

  if (!context.user.clients.create) {
    redirect("/");
  }

  return (
    <ProvisioningPlaceholder
      kind="company"
    />
  );
}
