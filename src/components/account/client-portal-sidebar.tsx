"use client";

import { PwaInstallButton } from "../pwa/pwa-provider";

import {
  BarChart3,
  CircleUserRound,
  FolderKanban,
  HandCoins,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessagesSquare,
  ReceiptText,
  ShoppingCart,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useTicketCacheRevocation } from "../tickets/use-ticket-cache-revocation";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { signOutAction } from "../../app/actions/auth";
import { WolfForgeMark } from "../shell/wolf-forge-mark";
import { usePortalDrawer } from "./command/portal-drawer";
import {
  portalRouteIsCurrent,
  type PortalNavigationCategory,
  type PortalNavigationItem,
} from "./portal-nav-registry";

const portalIcons: Record<string, ComponentType<{ "aria-hidden": true }>> = {
  portal_dashboard: LayoutDashboard,
  portal_projects: FolderKanban,
  portal_tickets: MessagesSquare,
  portal_forms: ListChecks,
  portal_reporting: BarChart3,
  portal_invoices: ReceiptText,
  portal_store: ShoppingCart,
  portal_subscriptions: HandCoins,
  portal_payment_method: Wallet,
  portal_profile: CircleUserRound,
};

function NavCount({ item }: { item: PortalNavigationItem }) {
  if (item.count === undefined) return null;

  return (
    <em
      className="portal-nav-count"
      data-actionable={item.countIsActionable ? "true" : "false"}
    >
      <span aria-hidden="true">{item.count}</span>
      <span className="sr-only">
        {item.countIsActionable
          ? `${item.count} waiting on you`
          : `${item.count} in progress`}
      </span>
    </em>
  );
}

export function ClientPortalSidebar({
  categories,
  companyName,
  displayName,
  workspaceName,
  brandingUnavailable = false,
}: {
  categories: PortalNavigationCategory[];
  companyName: string;
  displayName: string | null;
  workspaceName?: string;
  brandingUnavailable?: boolean;
}) {
  const pathname = usePathname();
  const brandName = brandingUnavailable ? "Workspace branding unavailable" : workspaceName ?? "Wolf Forge";
  const [revokedCategories, setRevokedCategories] = useState<PortalNavigationCategory[] | null>(null);
  useTicketCacheRevocation(() => setRevokedCategories(categories));
  const drawer = usePortalDrawer();
  const drawerOpen = drawer?.open ?? false;

  // Choosing a destination closes the mobile drawer. Handled on the event
  // rather than in an effect on pathname, so re-selecting the current route
  // still dismisses it and no cascading render is triggered.
  const closeDrawer = () => drawer?.setOpen(false);

  return (
    <>
      {drawerOpen ? (
        <button
          type="button"
          className="portal-scrim"
          aria-label="Close menu"
          onClick={closeDrawer}
        />
      ) : null}

      <aside
        id="portal-navigation"
        className={`portal-sidebar${drawerOpen ? " is-open" : ""}`}
      >
        {/*
         * The mark alone. The wordmark that sat beside it repeated what the
         * page title and the browser tab already say, and crowded a rail this
         * narrow.
         */}
        <Link
          href="/account"
          className="portal-brand"
          aria-label={`${brandName} client portal`}
          onClick={closeDrawer}
        >
          {brandingUnavailable ? <strong>{brandName}</strong> : <WolfForgeMark />}
          {workspaceName ? <strong className="tenant-workspace-name">{workspaceName}</strong> : null}
        </Link>

        <nav className="portal-nav" aria-label="Client portal">
          {categories.map((category) => (
            <section
              className="portal-nav-section"
              key={category.id}
              aria-labelledby={`portal-nav-${category.id}`}
            >
              <h2 id={`portal-nav-${category.id}`}>{category.label}</h2>

              <div className="portal-nav-links">
                {category.items.map((item) => {
                  const current = portalRouteIsCurrent(item, pathname);

                  /*
                   * Services is a plain destination here. The cart-oriented
                   * entry point that opens the chooser lives in the header
                   * command bar, so there is one of it rather than two controls
                   * with the same icon and different behaviour.
                   */
                  const Icon = portalIcons[item.id] ?? LayoutDashboard;

                  return (
                    <Link
                      key={item.id}
                      className={`portal-nav-link${current ? " is-active" : ""}`}
                      href={item.route}
                      aria-current={current ? "page" : undefined}
                      onClick={closeDrawer}
                    >
                      <Icon aria-hidden={true} />
                      <span>{item.label}</span>
                      {item.id !== "portal_tickets" || revokedCategories !== categories ? <NavCount item={item} /> : null}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        <div className="portal-account">
          <PwaInstallButton variant="portal" />
          <span className="portal-account-identity">
            <strong>{companyName}</strong>
            {displayName ? <span>{displayName}</span> : null}
          </span>
          <form action={signOutAction}>
            <button type="submit" className="portal-signout">
              <LogOut aria-hidden={true} />
              <span className="sr-only">Sign out</span>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
