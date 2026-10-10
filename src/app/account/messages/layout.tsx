import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { getClientContext } from "../../../lib/supabase/next-server";

export default async function MessagesLayout({ children }: { children: ReactNode }) {
  const context = await getClientContext();
  try {
    await context.services.permissions.requireModuleAccess("portal_tickets");
  } catch (error) {
    if (toClientSafeError(error).code !== "PERMISSION_DENIED") throw error;
    redirect("/account");
  }
  return <>{children}</>;
}
