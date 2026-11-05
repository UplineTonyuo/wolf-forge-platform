import { ClientAccountShell } from "../../components/account/client-account-shell";
import {
  toServiceChooserCatalog,
  type ServiceChooserCatalog,
} from "../../domain/client-portal/service-chooser";
import { getClientNavCounts } from "../../lib/supabase/client-portal-data";
import { getClientContext } from "../../lib/supabase/next-server";
import { WhiteLabelPublicationRepository } from "../../repositories/white-label-publication-repository";
import { WhiteLabelPublicationService } from "../../services/white-label-publication-service";
import { ClientDraftProvider } from "../../components/tickets/client-draft-provider";
import { studioDraftSavingAvailable } from "../../domain/tickets/draft-saving";
import { ClientSupportBanner } from "../../components/account/client-support-banner";

export const dynamic = "force-dynamic";

const emptyChooserCatalog: ServiceChooserCatalog = { folders: [], services: [] };

export default async function ClientAccountLayout({ children }: { children: React.ReactNode }) {
  const context = await getClientContext();
  const runtimeConfigurationPromise = new WhiteLabelPublicationService({
    repository: new WhiteLabelPublicationRepository(context.client),
  }).getRuntimeConfiguration().catch(() => null);

  /**
   * The service chooser reads the same client-visible catalog the Store page
   * renders, resolved once per request. When the account has no Store module
   * the query is skipped entirely, so the chooser never depends on data the
   * account is not entitled to read — and with an empty catalog its triggers
   * do not render at all.
   */
  const serviceCatalogPromise = context.user.modules.portal_store
    ? context.services.catalog.listStoreCatalog().then(toServiceChooserCatalog)
    : Promise.resolve(emptyChooserCatalog);

  /**
   * Rail counts are real row counts, memoized for the request so the Dashboard
   * reuses them rather than re-reading. A count that cannot be derived — a
   * denied module — arrives as null and no badge is rendered at all.
   *
   * The rail is decoration over an authorization decision made elsewhere, so a
   * failure to count must never take the workspace down with it.
   */
  const navCountsPromise = getClientNavCounts().catch(() => null);

  /*
   * The notification chime honours the account's own stored preference, so the
   * toggle on the Profile page controls something real. The same read supplies
   * the command bar's avatar. A failed read falls back to sound on, matching
   * the column default, and to initials.
   */
  const [runtimeConfiguration, serviceCatalog, navCounts, profile] = await Promise.all([
    runtimeConfigurationPromise,
    serviceCatalogPromise,
    navCountsPromise,
    context.services.profile.getMine().catch(() => null),
  ]);

  return (
    <ClientDraftProvider key={`${context.user.companyId}:${context.user.id}`} owner={studioDraftSavingAvailable(process.env) ? `${context.user.companyId}:${context.user.id}` : null}>
    <ClientAccountShell
      user={context.user}
      runtimeConfiguration={runtimeConfiguration}
      serviceCatalog={serviceCatalog}
      navCounts={navCounts}
      notificationSoundEnabled={profile?.notificationSoundEnabled ?? true}
      avatarUrl={profile?.avatarUrl ?? null}
    >
      {context.actor.support ? <ClientSupportBanner support={context.actor.support} /> : null}
      {children}
    </ClientAccountShell>
    </ClientDraftProvider>
  );
}
