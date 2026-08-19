import { redirect } from "next/navigation";
import { getInternalContext } from "../../lib/supabase/next-server";

/**
 * Owner and Admin land on the executive dashboard; every other internal role
 * keeps landing on To Do.
 *
 * signInAction already sends internal users to safeNextPath(next), which
 * defaults to "/", and this page owns "/", so this is the only place the
 * destination needs to be decided.
 */
export default async function InternalHomePage() {
  const { user } = await getInternalContext();
  redirect(user.modules.dashboard ? "/dashboard" : "/todo");
}
