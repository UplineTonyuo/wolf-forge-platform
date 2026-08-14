import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArchiveCouponButton } from "../../../../components/coupons/archive-coupon-button";
import { CouponForm, type CouponServiceOption } from "../../../../components/coupons/coupon-form";
import { PageFrame } from "../../../../components/ui/page-frame";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Edit Coupon" };

export default async function EditCouponPage({
  params,
  searchParams,
}: {
  params: Promise<{ couponId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const [{ couponId }, query] = await Promise.all([params, searchParams]);
  const context = await getInternalContext();

  try {
    const [detail, services, folders] = await Promise.all([
      context.services.coupons.get(couponId),
      context.services.catalog.listActive(),
      context.services.catalog.listFolders(),
    ]);
    const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
    const options: CouponServiceOption[] = services.map((service) => ({
      id: service.id,
      name: service.name,
      folderName: service.folder_id ? folderNames.get(service.folder_id) ?? null : null,
    }));

    return (
      <PageFrame title={detail.coupon.code} description="Edit coupon settings and ordered discount rules." action={<ArchiveCouponButton couponId={detail.coupon.id} code={detail.coupon.code} />}>
        {query.saved ? <div className="success-banner">Coupon changes saved.</div> : null}
        <CouponForm mode="edit" detail={detail} services={options} />
      </PageFrame>
    );
  } catch (error) {
    if (toClientSafeError(error).code === "NOT_FOUND") notFound();
    throw error;
  }
}
