import type { ClientNavCounts } from "../../domain/client-portal/summary";
import type { ServiceChooserCatalog } from "../../domain/client-portal/service-chooser";
import type { ClientUser } from "../../lib/supabase/next-server";
import { ClientCommandBar } from "./command/client-command-bar";
import { ClientPortalSidebar } from "./client-portal-sidebar";
import { PortalDrawerProvider } from "./command/portal-drawer";
import { ServiceChooserProvider } from "./services/service-chooser-context";
import { portalNavigationFor } from "./portal-nav-registry";

/**
 * The client workspace shell.
 *
 * Structurally a sibling of the internal shell, but a separate component on
 * purpose: it must never pull in WorkspaceCommandBar, global search or the
 * internal AccountMenu, all of which read internal data. Only client portal
 * modules are representable in portal-nav-registry, so no internal route can
 * appear here.
 *
 * The service chooser provider supplies the catalog; the chooser itself lives
 * in the command bar as a header panel, so it shares the single-panel manager
 * with notifications and quick actions.
 */
export function ClientAccountShell({
  user,
  serviceCatalog,
  navCounts = null,
  notificationSoundEnabled = true,
  avatarUrl = null,
  children,
}: {
  user: ClientUser;
  /** Real folders and services, already scoped by RLS. Empty without the module. */
  serviceCatalog: ServiceChooserCatalog;
  /** Real per-account counts, or null when they could not be derived. */
  navCounts?: ClientNavCounts | null;
  /** The account's own notification_sound_enabled preference. */
  notificationSoundEnabled?: boolean;
  avatarUrl?: string | null;
  children: React.ReactNode;
}) {
  const categories = portalNavigationFor(user.modules, navCounts);
  const storeGranted = user.modules.portal_store === true;

  return (
    <ServiceChooserProvider catalog={serviceCatalog} available={storeGranted}>
      <PortalDrawerProvider>
      <div className="client-portal">
        <a className="skip-link" href="#portal-main">
          Skip to content
        </a>

        {/* The sidebar reads the pathname to mark the active entry. */}
        <ClientPortalSidebar
          categories={categories}
          companyName={user.companyName}
          displayName={user.displayName}
        />

        <main id="portal-main" className="portal-main">
          <ClientCommandBar
            displayName={user.displayName}
            companyName={user.companyName}
            avatarUrl={avatarUrl}
            canMessage={user.modules.portal_tickets === true}
            projectsAvailable={user.modules.portal_projects === true}
            notificationSoundEnabled={notificationSoundEnabled}
          />

          <div className="portal-main-inner">{children}</div>
        </main>
      </div>
      </PortalDrawerProvider>
    </ServiceChooserProvider>
  );
}
