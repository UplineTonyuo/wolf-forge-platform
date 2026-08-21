import { redirect } from "next/navigation";
import { CreateClientAccountForm } from "../../../../../components/accounts/create-client-account-form";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export default async function AddClientAccountPage() {
  const context = await getInternalContext();
  await context.services.permissions.requireModuleAccess("clients");

  if (
    !context.user.clients.create ||
    !context.user.clients.privateManage ||
    !context.user.team.create
  ) {
    redirect("/");
  }

  return (
    <CreateClientAccountForm />
  );
}
