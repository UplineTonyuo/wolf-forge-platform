import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { getInternalContext } from "../../../lib/supabase/next-server";

export default async function TicketsLayout({ children }: { children: ReactNode }) {
  const context = await getInternalContext();
  try {
    await context.services.permissions.requireModuleAccess("tickets");
  } catch (error) {
    if (toClientSafeError(error).code !== "PERMISSION_DENIED") throw error;
    redirect("/");
  }
  return <>{children}</>;
}
