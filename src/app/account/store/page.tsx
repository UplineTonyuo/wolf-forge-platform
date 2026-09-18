import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StoreCatalogView } from "../../../components/account/store/store-catalog";
import { selectStoreFolder, type StoreCatalog } from "../../../domain/services/store-projections";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { getClientContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Store" };

const emptyCatalog: StoreCatalog = { folders: [], ungrouped: [], serviceCount: 0 };

export default async function ClientStorePage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const [{ folder }, { services }] = await Promise.all([searchParams, getClientContext()]);

  let catalog = emptyCatalog;
  let denied = false;
  let loadError: string | null = null;

  try {
    /*
     * portal_store resolves to store.view, a client-only capability. The
     * internal services.view is untouched, so nothing here grants a client
     * access to the internal Services module.
     */
    await services.permissions.requireModuleAccess("portal_store");
    catalog = await services.catalog.listStoreCatalog();
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "PERMISSION_DENIED") denied = true;
    else loadError = safe.message || "The Store could not be loaded.";
  }

  // redirect() throws its own control-flow error, so it stays outside the catch.
  if (denied) redirect("/account");

  if (loadError) {
    return (
      <div className="portal-page">
        <header className="portal-page-head">
          <h1>Store</h1>
        </header>
        <p className="portal-empty">{loadError}</p>
      </div>
    );
  }

  // An unknown or non-visible folder id falls back to the whole Store rather
  // than erroring, so a stale link never reveals whether a folder exists.
  return (
    <StoreCatalogView catalog={catalog} activeFolderId={selectStoreFolder(catalog, folder)?.id ?? null} />
  );
}
