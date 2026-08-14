import { forbidden } from "next/navigation";
import { getInternalContext } from "../../../lib/supabase/next-server";

export default async function InvoicesLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getInternalContext();
  if (!user.invoices.view && !user.invoices.manage) forbidden();
  return children;
}
