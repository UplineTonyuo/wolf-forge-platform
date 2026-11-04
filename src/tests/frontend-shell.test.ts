import { describe, expect, it } from "vitest";
import { navigationCategories, navigationForModules, titleForPath } from "../components/shell/nav-registry";

describe("Phase 3A navigation registry", () => {
  it("renders the complete Phase 3A.1 sidebar structure", () => {
    expect(navigationCategories.map((category) => category.label)).toEqual(["Overview", "Activity", "Billing", "Marketing", "Team", "Setup"]);
    expect(navigationCategories.flatMap((category) => category.items.map((item) => item.label))).toEqual([
      "Dashboard", "Orders", "Tickets", "Reporting", "Clients", "White Label", "Invoices", "Subscriptions", "Coupons", "Investment Intent", "Members", "Goals", "All Conversations", "Services", "Forms", "Settings",
    ]);
  });

  it("routes every sidebar item", () => {
    expect(navigationCategories.flatMap((category) => category.items.map((item) => item.route))).toEqual([
      "/dashboard", "/orders", "/tickets", "/reporting", "/clients", "/white-label", "/invoices", "/subscriptions", "/coupons", "/investment-intent", "/team", "/team/goals", "/team/all-conversations", "/services", "/forms", "/settings",
    ]);
  });

  /*
   * The executive dashboard is owner/admin only, enforced by the
   * dashboard.executive_view capability behind the 'dashboard' module key. A
   * role without that capability must not see the rail entry at all.
   */
  it("hides the dashboard from a role without the executive capability", () => {
    const withoutDashboard = navigationForModules({ projects: true, tickets: true });
    expect(withoutDashboard.map((category) => category.label)).toEqual(["Activity"]);
    expect(
      withoutDashboard.flatMap((category) => category.items.map((item) => item.id)),
    ).not.toContain("dashboard");
  });

  it("keeps user-facing order terminology in the shell", () => {
    expect(titleForPath("/orders")).toBe("Orders");
    expect(titleForPath("/orders/00000000-0000-0000-0000-000000000000")).toBe("Orders");
    expect(titleForPath("/todo")).toBe("Operations");
    expect(titleForPath("/coupons")).toBe("Coupons");
    expect(titleForPath("/companies")).toBe("Companies");
  });
});

describe("navigation derived from real module access", () => {
  it("uses Tenant module gates for CRM destinations and excludes the global admin entry", () => {
    // Goals uses separately verified internal membership, not a CRM module flag.
    const ids = navigationCategories.flatMap((category) => category.items.filter((item) => item.id !== "white_label" && item.id !== "team_goals").map((item) => item.id));
    const granted = Object.fromEntries(navigationCategories.flatMap((category) => category.items.map((item) => [item.id, true])));

    expect(navigationForModules(granted).flatMap((category) => category.items.map((item) => item.id))).toEqual(ids);
    expect(navigationForModules(granted, false, true).flatMap((category) => category.items.map((item) => item.id))).toEqual(
      navigationCategories.flatMap((category) => category.items.filter((item) => item.id !== "white_label").map((item) => item.id)),
    );
  });

  it("hides a module the resolver did not grant, and drops the emptied group", () => {
    // What app_current_user_modules returns for the seeded staff preset: no
    // users.view, no settings.view, no clients.view, no billing.
    const staffModules = {
      projects: true,
      tickets: true,
      todo: true,
      services: true,
      forms: true,
      clients: false,
      invoices: false,
      subscriptions: false,
      coupons: false,
      team: false,
      settings: false,
    };

    const visible = navigationForModules(staffModules);
    const labels = visible.flatMap((category) => category.items.map((item) => item.label));

    expect(labels).toEqual(["Orders", "Tickets", "Services", "Forms"]);
    expect(visible.map((category) => category.label)).toEqual(["Activity", "Setup"]);
  });

  it("treats an absent module as denied rather than visible", () => {
    expect(navigationForModules({}).flatMap((category) => category.items)).toEqual([]);
  });
});
