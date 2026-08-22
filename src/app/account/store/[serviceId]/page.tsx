import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { StoreServiceDetail } from "../../../../components/account/store/store-service-detail";
import { storeFolderRoute } from "../../../../components/account/portal-nav-registry";
import type { StoreServiceView } from "../../../../domain/services/store-projections";
import {
  resolveStorePurchaseOffer,
  type StorePurchaseOffer,
} from "../../../../domain/store/purchase";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { getClientContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Store" };

export default async function ClientStoreServicePage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const { serviceId } = await params;
  const context = await getClientContext();
  const { services } = context;

  let service: StoreServiceView | null = null;
  let folderName: string | null = null;
  let purchaseOffer: StorePurchaseOffer | null = null;
  let denied = false;
  let missing = false;

  try {
    await services.permissions.requireModuleAccess("portal_store");
    service = await services.catalog.getStoreService(serviceId);

    if (service.folderId) {
      const catalog = await services.catalog.listStoreCatalog();
      folderName = catalog.folders.find((folder) => folder.id === service?.folderId)?.name ?? null;
    }

    /*
     * Funding is read separately and is allowed to fail on its own. An account
     * whose wallet cannot be resolved — a denied billing module, a transient
     * error — still gets the Store page and the existing request flow; it simply
     * gets no purchase offer rather than an offer built on a guessed balance.
     * The company id comes from the resolved client context, never from the URL.
     */
    try {
      const [wallet, membership] = await Promise.all([
        services.wallets.getForCompany(context.user.companyId),
        services.wfCard.getMembership(context.user.companyId),
      ]);

      purchaseOffer = resolveStorePurchaseOffer({
        service,
        balanceCents: wallet.balance_cents,
        walletCurrency: wallet.currency,
        membershipStatus: membership?.status ?? null,
      });
    } catch {
      purchaseOffer = null;
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
      purchaseOffer={purchaseOffer}
    />
  );
}
