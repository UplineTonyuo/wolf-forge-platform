export type NavigationItemId =
  | "projects"
  | "tickets"
  | "clients"
  | "todo"
  | "invoices"
  | "subscriptions"
  | "coupons"
  | "services"
  | "forms"
  | "team"
  | "settings";

export type NavigationItem = {
  id: NavigationItemId;
  label: string;
  route: string;
};

export type NavigationCategory = {
  id: "activity" | "billing" | "marketing" | "setup";
  label: string;
  items: NavigationItem[];
};

export const navigationCategories: NavigationCategory[] = [
  {
    id: "activity",
    label: "Activity",
    items: [
      { id: "projects", label: "Projects", route: "/orders" },
      { id: "tickets", label: "Tickets", route: "/tickets" },
      { id: "clients", label: "Clients", route: "/clients" },
      { id: "todo", label: "To Do", route: "/todo" },
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
    items: [{ id: "coupons", label: "Coupons", route: "/coupons" }],
  },
  {
    id: "setup",
    label: "Setup",
    items: [
      { id: "services", label: "Services", route: "/services" },
      { id: "forms", label: "Forms", route: "/forms" },
      { id: "team", label: "Team", route: "/team" },
      { id: "settings", label: "Settings", route: "/settings" },
    ],
  },
];

export function navigationForCapabilities(
  canManageCoupons: boolean,
  canAccessInvoices = true,
  canAccessSubscriptions = true,
): NavigationCategory[] {
  return navigationCategories
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => (
        (item.id !== "coupons" || canManageCoupons)
        && (item.id !== "invoices" || canAccessInvoices)
        && (item.id !== "subscriptions" || canAccessSubscriptions)
      )),
    }))
    .filter((category) => category.items.length > 0);
}

export function routeIsCurrent(route: string, pathname: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function titleForPath(pathname: string): string {
  if (pathname === "/") return "To Do";
  if (pathname === "/clients/new") return "New client";
  if (pathname.startsWith("/clients/")) return "Client";
  const item = navigationCategories.flatMap((category) => category.items).find((entry) => routeIsCurrent(entry.route, pathname));
  return item?.label ?? "Wolf Forge";
}
