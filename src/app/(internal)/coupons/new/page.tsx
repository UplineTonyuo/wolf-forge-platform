import type { Metadata } from "next";
import { CouponForm, type CouponServiceOption } from "../../../../components/coupons/coupon-form";
import { PageFrame } from "../../../../components/ui/page-frame";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Add Coupon" };

export default async function NewCouponPage() {
  const context = await getInternalContext();
  const [services, folders] = await Promise.all([
    context.services.catalog.listActive(),
    context.services.catalog.listFolders(),
  ]);
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
  const options: CouponServiceOption[] = services.map((service) => ({
    id: service.id,
    name: service.name,
    folderName: service.folder_id ? folderNames.get(service.folder_id) ?? null : null,
  }));

  return <PageFrame title="Add Coupon"><CouponForm mode="create" services={options} /></PageFrame>;
}
