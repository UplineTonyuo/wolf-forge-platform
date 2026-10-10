import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { getInternalContext } from "../../../lib/supabase/next-server";

export default async function ProjectsLayout({ children }: { children: ReactNode }) {
  const context = await getInternalContext();
  let denied = false;
  try {
    await context.services.permissions.requireModuleAccess("projects");
  } catch (error) {
    if (toClientSafeError(error).code === "PERMISSION_DENIED") denied = true;
    else throw error;
  }
  if (denied) redirect("/");
  return <>{children}</>;
}
