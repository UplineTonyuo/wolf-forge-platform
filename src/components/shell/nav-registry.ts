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
  | "team_goals"
  | "team_supervision"
  | "settings";

export type NavigationItem = {
  id: NavigationItemId | "white_label";
  label: string;
  route: string;
  navigable?: boolean;
  children?: NavigationItem[];
};

export type NavigationCategory = {
  id: "overview" | "activity" | "billing" | "team" | "setup";
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
      { id: "projects", label: "Orders", route: "/orders" },
      { id: "tickets", label: "Tickets", route: "/tickets" },
      { id: "reporting", label: "Reporting", route: "/reporting" },
      { id: "clients", label: "Clients", route: "/clients" },
      { id: "white_label", label: "White Label", route: "/white-label" },
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
    id: "team",
    label: "Team",
    items: [
      { id: "team", label: "Members", route: "/team" },
      { id: "team_goals", label: "Goals", route: "/team/goals" },
      { id: "team_supervision", label: "All Conversations", route: "/team/all-conversations" },
    ],
  },
  {
    id: "setup",
    label: "Setup",
    items: [
      { id: "services", label: "Services", route: "/services", children: [
        { id: "coupons", label: "Coupons", route: "/coupons" },
        { id: "investment_intent", label: "Investment Intent", route: "/investment-intent" },
      ] },
      { id: "forms", label: "Forms", route: "/forms" },
      { id: "settings", label: "Settings", route: "/settings" },
    ],
  },
];

// CRM entries follow Tenant module grants; White Label uses a separate server-derived admin flag.
// Presentation grants nothing: routes, actions and database boundaries remain authoritative.
export function navigationForModules(
  modules: Record<string, boolean>,
  showWhiteLabel = false,
  includeGoals = false,
): NavigationCategory[] {
  return navigationCategories
    .map((category) => ({
      ...category,
      items: category.items.flatMap((item) => {
        const allowed = item.id === "white_label" ? showWhiteLabel : item.id === "team_goals" ? includeGoals : modules[item.id] === true;
        if (!item.children) return allowed ? [item] : [];
        const children = item.children.filter((child) => modules[child.id] === true);
        return allowed || children.length ? [{ ...item, navigable: allowed, children }] : [];
      }),
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
    .flatMap((category) => category.items.flatMap((item) => [item, ...item.children ?? []]))
    .filter((item) => routeIsCurrent(item.route, pathname))
    .sort((a, b) => b.route.length - a.route.length)[0]?.route;
}

export function titleForPath(pathname: string): string {
  if (pathname === "/") return "Operations";
  if (pathname === "/todo" || pathname.startsWith("/todo/")) return "Operations";
  if (pathname === "/clients/new") return "New client";
  if (pathname === "/companies") return "Companies";
  if (pathname === "/companies/new") return "New company";
  if (pathname.startsWith("/companies/")) return "Company";
  if (pathname === "/reporting/new") return "New report";
  if (pathname.startsWith("/reporting/")) return "Report";
  if (pathname.startsWith("/clients/")) return "Client";
  const route = activeNavigationRoute(pathname);
  const item = navigationCategories.flatMap((category) => category.items.flatMap((item) => [item, ...item.children ?? []])).find((entry) => entry.route === route);
  return item?.label ?? "Wolf Forge";
}
