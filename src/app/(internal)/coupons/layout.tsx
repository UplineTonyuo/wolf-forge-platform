import { forbidden } from "next/navigation";
import { getInternalContext } from "../../../lib/supabase/next-server";
import { CouponAccessBoundary } from "../../../components/coupons/coupon-access-boundary";

export default async function CouponsLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getInternalContext();
  if (!user.canManageCoupons) forbidden();
  return <CouponAccessBoundary>{children}</CouponAccessBoundary>;
}
