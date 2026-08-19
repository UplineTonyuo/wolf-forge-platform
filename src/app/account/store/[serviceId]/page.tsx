import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { StoreServiceDetail } from "../../../../components/account/store/store-service-detail";
import { storeFolderRoute } from "../../../../components/account/portal-nav-registry";
import type { StoreServiceView } from "../../../../domain/services/store-projections";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { getClientContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Store" };

export default async function ClientStoreServicePage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const { serviceId } = await params;
  const { services } = await getClientContext();

  let service: StoreServiceView | null = null;
  let folderName: string | null = null;
  let denied = false;
  let missing = false;

  try {
    await services.permissions.requireModuleAccess("portal_store");
    service = await services.catalog.getStoreService(serviceId);

    if (service.folderId) {
      const catalog = await services.catalog.listStoreCatalog();
      folderName = catalog.folders.find((folder) => folder.id === service?.folderId)?.name ?? null;
    }
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "PERMISSION_DENIED") denied = true;
    // A private, inactive or archived service is filtered by the repository
    // predicates and by RLS, so it reaches the portal as "not found".
    else missing = true;
  }

  if (denied) redirect("/account");
  if (missing || !service) notFound();

  return (
    <StoreServiceDetail
      service={service}
      folderName={folderName}
      backHref={service.folderId && folderName ? storeFolderRoute(service.folderId) : "/account/store"}
    />
  );
}
