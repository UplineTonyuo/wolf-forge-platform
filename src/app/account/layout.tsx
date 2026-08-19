import { ClientAccountShell } from "../../components/account/client-account-shell";
import {
  toServiceChooserCatalog,
  type ServiceChooserCatalog,
} from "../../domain/client-portal/service-chooser";
import type { ClientNavCounts } from "../../domain/client-portal/summary";
import { getClientNavCounts } from "../../lib/supabase/client-portal-data";
import { getClientContext } from "../../lib/supabase/next-server";

export const dynamic = "force-dynamic";

const emptyChooserCatalog: ServiceChooserCatalog = { folders: [], services: [] };

export default async function ClientAccountLayout({ children }: { children: React.ReactNode }) {
  const context = await getClientContext();

  /**
   * The service chooser reads the same client-visible catalog the Store page
   * renders, resolved once per request. When the account has no Store module
   * the query is skipped entirely, so the chooser never depends on data the
   * account is not entitled to read — and with an empty catalog its triggers
   * do not render at all.
   */
  let serviceCatalog = emptyChooserCatalog;
  if (context.user.modules.portal_store) {
    serviceCatalog = toServiceChooserCatalog(await context.services.catalog.listStoreCatalog());
  }

  /**
   * Rail counts are real row counts, memoized for the request so the Dashboard
   * reuses them rather than re-reading. A count that cannot be derived — a
   * denied module — arrives as null and no badge is rendered at all.
   *
   * The rail is decoration over an authorization decision made elsewhere, so a
   * failure to count must never take the workspace down with it.
   */
  let navCounts: ClientNavCounts | null = null;
  try {
    navCounts = await getClientNavCounts();
  } catch {
    navCounts = null;
  }

  /*
   * The notification chime honours the account's own stored preference, so the
   * toggle on the Profile page controls something real. The same read supplies
   * the command bar's avatar. A failed read falls back to sound on, matching
   * the column default, and to initials.
   */
  const profile = await context.services.profile.getMine().catch(() => null);

  return (
    <ClientAccountShell
      user={context.user}
      serviceCatalog={serviceCatalog}
      navCounts={navCounts}
      notificationSoundEnabled={profile?.notificationSoundEnabled ?? true}
      avatarUrl={profile?.avatarUrl ?? null}
    >
      {children}
    </ClientAccountShell>
  );
}
