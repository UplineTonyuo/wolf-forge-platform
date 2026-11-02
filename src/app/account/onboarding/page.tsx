import { redirect } from "next/navigation";
import { getClientContext } from "../../../lib/supabase/next-server";
import { toClientSafeError } from "../../../lib/errors/application-error";

// Preserve bookmarked/notification URLs while assigned forms live in Orders.
export default async function ClientOnboardingPage() {
  const { services } = await getClientContext();
  try {
    await services.permissions.requireModuleAccess("portal_forms");
  } catch (error) {
    if (toClientSafeError(error).code === "PERMISSION_DENIED") redirect("/account");
    throw error;
  }
  redirect("/account/projects#forms");
}