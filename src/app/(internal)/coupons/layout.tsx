import { forbidden } from "next/navigation";
import { getInternalContext } from "../../../lib/supabase/next-server";

export default async function CouponsLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getInternalContext();
  if (!user.canManageCoupons) forbidden();
  return children;
}
