import { redirect } from "next/navigation";
import { ProvisioningPlaceholder } from "../../../../../components/accounts/provisioning-placeholder";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export default async function AddMemberAccountPage() {
  const { user } =
    await getInternalContext();

  if (
    user.role !== "owner" &&
    user.role !== "admin"
  ) {
    redirect("/");
  }

  return (
    <ProvisioningPlaceholder
      kind="member"
    />
  );
}