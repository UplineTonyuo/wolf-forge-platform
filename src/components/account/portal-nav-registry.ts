import type { ClientNavCounts } from "../../domain/client-portal/summary";

/**
 * The client portal navigation registry.
 *
 * Deliberately a separate file from the internal src/components/shell/
 * nav-registry.ts. No internal navigation id is representable in this module's
 * types, so an internal route cannot reach the portal through a mistake in a
 * filter — the entries simply do not exist.
 *
 * Every gated id is a client-class public.permission_modules key (portal_*),
 * and visibility is resolved from app_current_user_modules(). That is
 * presentation only: each page still calls app_require_module_access()
 * server-side, and RLS remains the authority on rows.
 *
 * The structure is organised around what a client needs to *do* rather than
 * around Wolf Forge's internal modules. Renaming and regrouping is all that
 * changed: no module key was invented, no page was duplicated. Forms became
 * Onboarding, Tickets became Messages, Browse Store became Investments, and
 * Payment method is a new page behind the existing portal_invoices gate.
 *
 * The rail deliberately carries no service categories. They are reachable from
 * the Services entry, which opens the chooser.
 */
export type PortalNavigationItemId =
  | "portal_dashboard"
  | "portal_projects"
  | "portal_tickets"
  | "portal_reporting"
  | "portal_store"
  | "portal_forms"
  | "portal_invoices"
  | "portal_subscriptions"
  /**
   * Payment method reads no billing rows of its own — it presents the account's
   * funding state — so it rides the portal_invoices grant rather than
   * introducing a module key the database does not know about.
   */
  | "portal_payment_method"
  /**
   * Profile is self-service. app_get_my_profile and app_update_my_profile are
   * granted to `authenticated` and derive the account from auth.uid(), so every
   * signed-in account can reach it and no account can reach anyone else's.
   */
  | "portal_profile";

/** Which module grant, if any, a navigation item depends on. */
const moduleGateFor: Record<PortalNavigationItemId, string | null> = {
  portal_dashboard: "portal_dashboard",
  portal_projects: "portal_projects",
  portal_tickets: "portal_tickets",
  portal_reporting: "portal_reporting",
  portal_store: "portal_store",
  portal_forms: "portal_forms",
  portal_invoices: "portal_invoices",
  portal_subscriptions: "portal_subscriptions",
  portal_payment_method: "portal_invoices",
  portal_profile: null,
};

export function portalModuleGate(id: PortalNavigationItemId): string | null {
  return moduleGateFor[id];
}

export type PortalNavigationItem = {
  id: PortalNavigationItemId;
  label: string;
  route: string;
  /**
   * True when the route should only match exactly. /account is the dashboard
   * and a prefix of every other portal route, so it cannot use prefix matching.
   */
  exact?: boolean;
  /**
   * A real count of rows needing the client, resolved per request. Absent when
   * the module is denied or the count is zero — an empty badge is noise.
   */
  count?: number;
  /** True when the count represents work blocked on the client. */
  countIsActionable?: boolean;
};

export type PortalNavigationCategory = {
  id: "overview" | "work" | "services" | "billing" | "account";
  label: string;
  items: PortalNavigationItem[];
};

export const portalNavigationCategories: PortalNavigationCategory[] = [
  {
    id: "overview",
    label: "Overview",
    items: [{ id: "portal_dashboard", label: "Dashboard", route: "/account", exact: true }],
  },
  {
    id: "work",
    label: "Work",
    items: [
      { id: "portal_projects", label: "Orders", route: "/account/projects" },
      { id: "portal_tickets", label: "Inbox", route: "/account/messages" },
      { id: "portal_reporting", label: "Reporting", route: "/account/reporting" },
    ],
  },
  {
    id: "services",
    label: "Investments",
    items: [{ id: "portal_store", label: "Investments", route: "/account/store" }],
  },
  {
    id: "billing",
    label: "Billing",
    items: [
      { id: "portal_invoices", label: "Invoices", route: "/account/invoices" },
      { id: "portal_subscriptions", label: "Subscriptions", route: "/account/subscriptions" },
      { id: "portal_payment_method", label: "Payment method", route: "/account/payment-method" },
    ],
  },
  {
    id: "account",
    label: "Account",
    items: [{ id: "portal_profile", label: "Profile", route: "/account/profile" }],
  },
];

/**
 * The Store page still accepts a folder filter; the rail simply no longer
 * enumerates every folder as a permanent list. Kept because the Store page and
 * the dashboard's category chips both link through it.
 */
export function storeFolderRoute(folderId: string): string {
  return `/account/store?folder=${encodeURIComponent(folderId)}`;
}

/**
 * Which navigation ids carry a count, and whether that count means the client
 * is the blocker. Projects reports work in flight — useful, but not a call to
 * action — so it is rendered in a quieter treatment than the other two.
 */
const countSources: Array<{
  id: PortalNavigationItemId;
  key: keyof ClientNavCounts;
  actionable: boolean;
}> = [
  { id: "portal_projects", key: "projects", actionable: false },
  { id: "portal_tickets", key: "messages", actionable: true },
  /*
   * Unopened reports. Actionable because a report the client has not seen is
   * something waiting for them; the count is a real row count from
   * app_count_my_unread_reports and is absent when Reporting is not granted.
   */
  { id: "portal_reporting", key: "reporting", actionable: true },
];

function withCount(
  item: PortalNavigationItem,
  counts: ClientNavCounts | null,
): PortalNavigationItem {
  if (!counts) return item;

  const source = countSources.find((entry) => entry.id === item.id);
  if (!source) return item;

  const value = counts[source.key];
  // null means the module is denied, undefined means the count was not gathered,
  // 0 means nothing is pending. None earns a badge, so all fall through.
  if (value === null || value === undefined || value === 0) return item;

  return { ...item, count: value, countIsActionable: source.actionable };
}

/**
 * The rail no longer expands the service catalog.
 *
 * It previously rendered every visible folder as a permanently open child list,
 * which pushed the rest of the navigation down and turned browsing into
 * scanning. Categories now live in the service chooser, which is opened from
 * the Services entry.
 */
export function portalNavigationFor(
  modules: Record<string, boolean>,
  counts: ClientNavCounts | null = null,
): PortalNavigationCategory[] {
  return portalNavigationCategories
    .map((category) => ({
      ...category,
      items: category.items
        .filter((item) => {
          // Orders also houses assigned forms; each dataset keeps its own
          // server-side grant. This must not orphan Forms-only accounts.
          if (item.id === "portal_projects") return modules.portal_projects === true || modules.portal_forms === true;
          const gate = portalModuleGate(item.id);
          return gate === null || modules[gate] === true;
        })
        .map((item) => withCount(item, counts)),
    }))
    .filter((category) => category.items.length > 0);
}

export function portalRouteIsCurrent(
  item: Pick<PortalNavigationItem, "route" | "exact">,
  pathname: string,
): boolean {
  if (item.exact) return pathname === item.route;
  if (item.route === "/account/projects" && (pathname === "/account/onboarding" || pathname.startsWith("/account/onboarding/"))) return true;
  return pathname === item.route || pathname.startsWith(`${item.route}/`);
}

export function portalTitleForPath(pathname: string): string {
  if (pathname === "/account") return "Dashboard";

  const item = portalNavigationCategories
    .flatMap((category) => category.items)
    .find((entry) => portalRouteIsCurrent(entry, pathname));

  return item?.label ?? "Wolf Forge";
}
