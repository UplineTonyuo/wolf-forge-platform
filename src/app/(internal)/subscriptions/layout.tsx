import { forbidden } from "next/navigation";
import { getInternalContext } from "../../../lib/supabase/next-server";

export default async function SubscriptionsLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getInternalContext();
  if (!user.subscriptions.view && !user.subscriptions.manage && !user.subscriptions.billing) forbidden();
  return children;
}
