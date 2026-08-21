import { getInternalContext } from "../../../lib/supabase/next-server";

export default async function ClientsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const context = await getInternalContext();
  await context.services.permissions.requireModuleAccess("clients");
  return children;
}
