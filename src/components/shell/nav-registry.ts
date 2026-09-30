export type NavigationItemId =
  | "dashboard"
  | "projects"
  | "tickets"
  | "reporting"
  | "clients"
  | "todo"
  | "invoices"
  | "subscriptions"
  | "coupons"
  | "investment_intent"
  | "services"
  | "forms"
  | "team"
  | "team_supervision"
  | "settings";

export type NavigationItem = {
  id: NavigationItemId;
  label: string;
  route: string;
};

export type NavigationCategory = {
  id: "overview" | "activity" | "billing" | "marketing" | "setup";
  label: string;
  items: NavigationItem[];
};

export const navigationCategories: NavigationCategory[] = [
  {
    id: "overview",
    label: "Overview",
    items: [{ id: "dashboard", label: "Dashboard", route: "/dashboard" }],
  },
  {
    id: "activity",
    label: "Activity",
    items: [
      { id: "projects", label: "Projects", route: "/orders" },
      { id: "tickets", label: "Tickets", route: "/tickets" },
      { id: "reporting", label: "Reporting", route: "/reporting" },
      { id: "clients", label: "Clients", route: "/clients" },
      { id: "todo", label: "Operations", route: "/todo" },
    ],
  },
  {
    id: "billing",
    label: "Billing",
    items: [
      { id: "invoices", label: "Invoices", route: "/invoices" },
      { id: "subscriptions", label: "Subscriptions", route: "/subscriptions" },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    items: [
      { id: "coupons", label: "Coupons", route: "/coupons" },
      { id: "investment_intent", label: "Investment Intent", route: "/investment-intent" },
    ],
  },
  {
    id: "setup",
    label: "Setup",
    items: [
      { id: "services", label: "Services", route: "/services" },
      { id: "forms", label: "Forms", route: "/forms" },
      { id: "team", label: "Team", route: "/team" },
      { id: "team_supervision", label: "All Conversations", route: "/team/all-conversations" },
      { id: "settings", label: "Settings", route: "/settings" },
    ],
  },
];

/**
 * Visibility comes from public.permission_modules through
 * app_current_user_modules(), so the rail can never drift from the capability
 * that actually gates a screen. Every navigation id is also a module key.
 *
 * This is presentation only. app_require_module_access() and the RPC boundary
 * stay authoritative, so a typed URL is still rejected for a hidden module.
 */
export function navigationForModules(
  modules: Record<string, boolean>,
): NavigationCategory[] {
  return navigationCategories
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => modules[item.id] === true),
    }))
    .filter((category) => category.items.length > 0);
}

export function routeIsCurrent(route: string, pathname: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/**
 * The one navigation route that owns the path: the longest match, so
 * /team/all-conversations lights All Conversations and not also Team.
 */
export function activeNavigationRoute(pathname: string): string | undefined {
  return navigationCategories
    .flatMap((category) => category.items)
    .filter((item) => routeIsCurrent(item.route, pathname))
    .sort((a, b) => b.route.length - a.route.length)[0]?.route;
}

export function titleForPath(pathname: string): string {
  if (pathname === "/") return "Operations";
  if (pathname === "/clients/new") return "New client";
  if (pathname === "/reporting/new") return "New report";
  if (pathname.startsWith("/reporting/")) return "Report";
  if (pathname.startsWith("/clients/")) return "Client";
  const route = activeNavigationRoute(pathname);
  const item = navigationCategories.flatMap((category) => category.items).find((entry) => entry.route === route);
  return item?.label ?? "Wolf Forge";
}
