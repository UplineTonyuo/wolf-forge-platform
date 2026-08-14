import { InternalShell } from "../../components/shell/internal-shell";
import { getInternalContext } from "../../lib/supabase/next-server";

export const dynamic = "force-dynamic";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getInternalContext();
  return <InternalShell user={user}>{children}</InternalShell>;
}
