"use client";

import {
  ListChecks,
  Menu,
  X,
  FileText,
  FolderKanban,
  FormInput,
  HandCoins,
  LayoutDashboard,
  MessagesSquare,
  ReceiptText,
  Settings,
  ShieldCheck,
  Tags,
  Target,
  TicketCheck,
  TrendingUp,
  UsersRound,
  Wrench,
  Palette,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect, useOptimistic, useRef, useState } from "react";
import type {
  ComponentType,
  MouseEvent,
  ReactNode,
} from "react";
import type { InternalUser } from "../../lib/supabase/next-server";
import { activeNavigationRoute, navigationForModules } from "./nav-registry";
import { WolfForgeMark } from "./wolf-forge-mark";
import { WorkspaceCommandBar } from "./workspace-command-bar";
import { AccountMenu } from "./account-menu";
import { TeamPresenceProvider } from "../team/team-presence-provider";
import { RouteSkeleton } from "./route-skeletons";
import { coveredRoute, RouteTransitionProvider } from "./route-transition";
import { TicketAccessBoundary } from "../tickets/ticket-access-boundary";
import { WHITE_LABEL_PUBLICATION_CONTRACT_VERSION, type RuntimeWhiteLabelConfiguration } from "../../domain/white-label/publication";
import { TenantBrandingProvider, useRuntimeBranding, type RuntimeBrandingReader } from "./tenant-branding-provider";

export const navigationIcons: Record<string, ComponentType<{ "aria-hidden": true }>> = {
  dashboard: LayoutDashboard,
  projects: FolderKanban,
  tickets: TicketCheck,
  clients: UsersRound,
  todo: ListChecks,
  invoices: ReceiptText,
  subscriptions: HandCoins,
  coupons: Tags,
  /* Buying interest is an opportunity on the way up; Sparkles read as an AI feature. */
  investment_intent: TrendingUp,
  services: Wrench,
  forms: FormInput,
  team: ShieldCheck,
  team_goals: Target,
  team_supervision: MessagesSquare,
  settings: Settings,
  white_label: Palette,
};

function SidebarLink({
  id,
  label,
  route,
  active,
  transitioning,
  onNavigate,
}: {
  id: string;
  label: string;
  route: string;
  active: boolean;
  transitioning: boolean;
  onNavigate: (
    route: string,
    event: MouseEvent<HTMLAnchorElement>,
  ) => void;
}) {
  const Icon =
    navigationIcons[id] ?? FileText;

  const className = [
    "sidebar-link",
    active ? "is-active" : "",
    transitioning
      ? "is-transition-target"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link
      className={className}
      href={route}
      aria-current={
        active ? "page" : undefined
      }
      onClick={(event) =>
        onNavigate(route, event)
      }
    >
      <Icon aria-hidden={true} />
      <span>{label}</span>
    </Link>
  );
}

export function InternalShell({
  user,
  notificationSoundEnabled = true,
  showWhiteLabel = false,
  runtimeConfiguration,
  readRuntimeConfiguration,
  children,
}: {
  user: InternalUser;
  /** The profile's stored chime preference, passed through to the bell. */
  notificationSoundEnabled?: boolean;
  showWhiteLabel?: boolean;
  runtimeConfiguration?: RuntimeWhiteLabelConfiguration | null;
  readRuntimeConfiguration?: RuntimeBrandingReader;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const controlPlane = pathname === "/white-label" || pathname.startsWith("/white-label/");
  const brandingState = useRuntimeBranding(runtimeConfiguration, `${user.id}:${user.tenantId}`, !controlPlane, readRuntimeConfiguration);
  const { branding, unavailable } = brandingState;
  const workspaceName = unavailable ? "Workspace branding unavailable" : branding?.name ?? "Wolf Forge";
  const ticketRoute = pathname === "/tickets" || pathname.startsWith("/tickets/");
  const router = useRouter();
  // This shell receives a verified internal member. Goals has its own database
  // boundary; exposing it does not grant access to Members or supervision.
  const navigationCategories = navigationForModules(user.modules, showWhiteLabel, true);
  const mobileDrawerRef = useRef<HTMLDialogElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (desktop.matches) mobileDrawerRef.current?.close();
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  /*
   * A sidebar click swaps the content pane to the destination's skeleton at
   * once and marks the destination active. The pending route is optimistic
   * state tied to the navigation transition, so React drops it in the same
   * commit as the destination page, and also when the navigation is
   * superseded, cancelled or lands back on the current path. The pane is
   * never hidden, so a slow or unprefetched route can't read as blank.
   */
  const [pendingRoute, setPendingRoute] = useOptimistic<string | null>(null);

  function begin(url: URL) {
    const route = coveredRoute(url, pathname, (path) => !/^\/(account|api|activate|f|launch|login)(\/|$)/.test(path));
    if (route) setPendingRoute(route);
  }

  function handleSidebarNavigate(
    route: string,
    event: MouseEvent<HTMLAnchorElement>,
  ) {
    // Preserve normal browser behavior for new tabs / modified clicks.
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    // Exact: from /team/all-conversations a Team click must still navigate.
    if (route === pathname && !pendingRoute) return;

    startTransition(() => {
      setPendingRoute(route === pathname ? null : route);
      router.push(route);
    });
  }

  function renderNavigation(mobile = false) {
    return (
      <nav className="sidebar-navigation" aria-label={mobile ? "Mobile primary" : "Primary"}>
        {navigationCategories.map((category) => (
          <section className="sidebar-section" key={category.id} aria-labelledby={`${mobile ? "mobile-" : ""}nav-${category.id}`}>
            <h2 id={`${mobile ? "mobile-" : ""}nav-${category.id}`}>{category.label}</h2>
            <div className="sidebar-links">
              {category.items.map((item) => (
                <SidebarLink
                  key={item.id}
                  {...item}
                  active={item.route === activeNavigationRoute(pendingRoute ?? pathname)}
                  transitioning={pendingRoute === item.route}
                  onNavigate={(route, event) => {
                    if (mobile) mobileDrawerRef.current?.close();
                    handleSidebarNavigate(route, event);
                  }}
                />
              ))}
            </div>
          </section>
        ))}
      </nav>
    );
  }

  if (branding && branding.tenantId !== user.tenantId) {
    throw new Error("Workspace branding scope mismatch.");
  }

  return (
    <TenantBrandingProvider value={brandingState}>
    <RouteTransitionProvider begin={begin}>
    <TeamPresenceProvider enabled={user.teamMessaging.use}>
      <div
        className={`internal-app${branding ? " tenant-workspace" : ""}`}
        style={branding?.style}
        data-branding-tenant={branding?.tenantId}
        data-branding-revision={branding?.revision}
        data-branding-contract={branding ? WHITE_LABEL_PUBLICATION_CONTRACT_VERSION : undefined}
        data-branding-state={unavailable ? "unavailable" : undefined}
      >
      <a
        className="skip-link"
        href="#main-content"
      >
        Skip to content
      </a>

      <aside className="app-sidebar">
        <div
          className={`sidebar-brand${branding ? "" : " is-mark-only"}`}
          aria-label={workspaceName}
        >
          {unavailable ? <strong>{workspaceName}</strong> : <WolfForgeMark />}
          {branding ? <strong className="tenant-workspace-name">{branding.name}</strong> : null}
        </div>

        {renderNavigation()}
      </aside>

      <dialog
        ref={mobileDrawerRef}
        id="mobile-navigation"
        className="mobile-nav-drawer"
        aria-label={`${workspaceName} navigation`}
        onClose={() => setMobileOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) mobileDrawerRef.current?.close();
        }}
      >
        <div className="mobile-nav-header">
          <strong>{unavailable ? workspaceName : branding?.name ?? "WOLF FORGE"}</strong>
          <button type="button" aria-label="Close navigation" onClick={() => mobileDrawerRef.current?.close()}>
            <X aria-hidden="true" />
          </button>
        </div>
        {renderNavigation(true)}
        <AccountMenu user={user} sidebar />
      </dialog>

      <div
        id="main-content"
        className="workspace"
      >
        {unavailable ? <p className="tenant-branding-error" role="alert">Workspace branding is unavailable. Reload or try again shortly.</p> : null}
        <WorkspaceCommandBar
          user={user}
          notificationSoundEnabled={
            notificationSoundEnabled
          }
          mobileNavigation={
            <button
              type="button"
              className="mobile-nav-trigger"
              aria-label="Open navigation"
              aria-controls="mobile-navigation"
              aria-haspopup="dialog"
              aria-expanded={mobileOpen}
              onClick={() => {
                mobileDrawerRef.current?.showModal();
                setMobileOpen(true);
              }}
            >
              <Menu aria-hidden="true" />
            </button>
          }
        />

        <main className="workspace-route-stage">
          {pendingRoute ? <RouteSkeleton pathname={pendingRoute} /> : null}
          <div className="workspace-route-content" hidden={pendingRoute !== null} aria-busy={pendingRoute !== null}>
          {ticketRoute ? (
            user.tickets.view ? (
              <TicketAccessBoundary key={pathname} ticketId={pathname.split("/")[2]} listenForModuleDenial>
                {children}
              </TicketAccessBoundary>
            ) : <p role="alert">This conversation is unavailable.</p>
          ) : children}
          </div>
        </main>
      </div>
      </div>
    </TeamPresenceProvider>
    </RouteTransitionProvider>
    </TenantBrandingProvider>
  );
}
