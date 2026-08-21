import { getInternalContext } from "../../../lib/supabase/next-server";

export default async function ServicesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const context = await getInternalContext();
  await context.services.permissions.requireModuleAccess("services");
  return children;
}
