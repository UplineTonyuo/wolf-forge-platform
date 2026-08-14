import { ClientAccountShell } from "../../components/account/client-account-shell";
import { getClientContext } from "../../lib/supabase/next-server";

export const dynamic = "force-dynamic";

export default async function ClientAccountLayout({ children }: { children: React.ReactNode }) {
  const context = await getClientContext();
  return <ClientAccountShell companyName={context.user.companyName}>{children}</ClientAccountShell>;
}
