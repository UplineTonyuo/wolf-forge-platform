import { redirect } from "next/navigation";
import { CreateMemberAccountForm } from "../../../../../components/accounts/create-member-account-form";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export const metadata = {
  title: "Add team member",
};

export default async function AddMemberAccountPage() {
  const { user } = await getInternalContext();

  /*
   * Gated on the real capabilities the provisioning RPC itself requires rather
   * than on a role name. The database re-authorizes against auth.uid() either
   * way; this only avoids showing a form that cannot succeed.
   */
  if (!user.team.create || !user.team.managePermissions) {
    redirect("/");
  }

  return <CreateMemberAccountForm />;
}
