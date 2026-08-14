import { redirect } from "next/navigation";
import { CreateClientAccountForm } from "../../../../../components/accounts/create-client-account-form";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export default async function AddClientAccountPage() {
  const { user } =
    await getInternalContext();

  if (
    user.role !== "owner" &&
    user.role !== "admin"
  ) {
    redirect("/");
  }

  return (
    <CreateClientAccountForm />
  );
}