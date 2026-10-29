"use client";

import { startTransition, useOptimistic, type MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ClientNavCounts } from "../../domain/client-portal/summary";
import type { ServiceChooserCatalog } from "../../domain/client-portal/service-chooser";
import type { ClientUser } from "../../lib/supabase/next-server";
import { ClientCommandBar } from "./command/client-command-bar";
import { ClientPortalSidebar } from "./client-portal-sidebar";
import { ClientRouteSkeleton } from "./client-route-skeleton";
import { PortalDrawerProvider } from "./command/portal-drawer";
import { ServiceChooserProvider } from "./services/service-chooser-context";
import { portalNavigationFor } from "./portal-nav-registry";
import { WHITE_LABEL_PUBLICATION_CONTRACT_VERSION, type RuntimeWhiteLabelConfiguration } from "../../domain/white-label/publication";
import { TenantBrandingProvider, useRuntimeBranding, type RuntimeBrandingReader } from "../shell/tenant-branding-provider";
import { coveredRoute, RouteTransitionProvider } from "../shell/route-transition";

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
  runtimeConfiguration,
  readRuntimeConfiguration,
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
  runtimeConfiguration?: RuntimeWhiteLabelConfiguration | null;
  readRuntimeConfiguration?: RuntimeBrandingReader;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingRoute, setPendingRoute] = useOptimistic<string | null>(null);
  const categories = portalNavigationFor(user.modules, navCounts);
  const storeGranted = user.modules.portal_store === true;
  const brandingState = useRuntimeBranding(runtimeConfiguration, `${user.id}:${user.companyId}`, true, readRuntimeConfiguration);
  const { branding, unavailable } = brandingState;

  function begin(url: URL) {
    const route = coveredRoute(url, pathname, (path) => path === "/account" || path.startsWith("/account/"));
    if (route) setPendingRoute(route);
  }

  function navigate(route: string, event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (route === pathname && !pendingRoute) return;
    startTransition(() => {
      setPendingRoute(route === pathname ? null : route);
      router.push(route);
    });
  }

  return (
    <TenantBrandingProvider value={brandingState}>
    <RouteTransitionProvider begin={begin}>
    <ServiceChooserProvider catalog={serviceCatalog} available={storeGranted}>
      <PortalDrawerProvider>
      <div
        className={`client-portal${branding ? " tenant-workspace" : ""}`}
        style={branding?.style}
        data-branding-tenant={branding?.tenantId}
        data-branding-revision={branding?.revision}
        data-branding-contract={branding ? WHITE_LABEL_PUBLICATION_CONTRACT_VERSION : undefined}
        data-branding-state={unavailable ? "unavailable" : undefined}
      >
        <a className="skip-link" href="#portal-main">
          Skip to content
        </a>

        {/* The sidebar reads the pathname to mark the active entry. */}
        <ClientPortalSidebar
          categories={categories}
          companyName={user.companyName}
          displayName={user.displayName}
          workspaceName={branding?.name}
          brandingUnavailable={unavailable}
          pendingRoute={pendingRoute}
          onNavigate={navigate}
        />

        <main id="portal-main" className="portal-main">
          {unavailable ? <p className="tenant-branding-error" role="alert">Workspace branding is unavailable. Reload or try again shortly.</p> : null}
          <ClientCommandBar
            pendingRoute={pendingRoute}
            displayName={user.displayName}
            companyName={user.companyName}
            avatarUrl={avatarUrl}
            canMessage={user.modules.portal_tickets === true}
            projectsAvailable={user.modules.portal_projects === true}
            notificationSoundEnabled={notificationSoundEnabled}
          />

          <div className="portal-main-inner" aria-busy={pendingRoute !== null}>
            {pendingRoute ? <ClientRouteSkeleton pathname={pendingRoute} /> : null}
            {/* Keep unsent editor state mounted until navigation commits. */}
            <div hidden={pendingRoute !== null}>{children}</div>
          </div>
        </main>
      </div>
      </PortalDrawerProvider>
    </ServiceChooserProvider>
    </RouteTransitionProvider>
    </TenantBrandingProvider>
  );
}
