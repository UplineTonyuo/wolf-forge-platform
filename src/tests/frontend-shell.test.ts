import { describe, expect, it } from "vitest";
import { navigationCategories, navigationForModules, titleForPath } from "../components/shell/nav-registry";

describe("Phase 3A navigation registry", () => {
  it("renders the complete Phase 3A.1 sidebar structure", () => {
    expect(navigationCategories.map((category) => category.label)).toEqual(["Activity", "Billing", "Marketing", "Setup"]);
    expect(navigationCategories.flatMap((category) => category.items.map((item) => item.label))).toEqual([
      "Projects", "Tickets", "Clients", "To Do", "Invoices", "Subscriptions", "Coupons", "Services", "Forms", "Team", "Settings",
    ]);
  });

  it("routes every sidebar item", () => {
    expect(navigationCategories.flatMap((category) => category.items.map((item) => item.route))).toEqual([
      "/orders", "/tickets", "/clients", "/todo", "/invoices", "/subscriptions", "/coupons", "/services", "/forms", "/team", "/settings",
    ]);
  });

  it("keeps user-facing project terminology in the shell", () => {
    expect(titleForPath("/orders")).toBe("Projects");
    expect(titleForPath("/orders/00000000-0000-0000-0000-000000000000")).toBe("Projects");
    expect(titleForPath("/todo")).toBe("To Do");
    expect(titleForPath("/coupons")).toBe("Coupons");
  });
});

describe("navigation derived from real module access", () => {
  /** Every navigation id is also a public.permission_modules module key. */
  it("uses module keys that match the navigation ids one for one", () => {
    const ids = navigationCategories.flatMap((category) => category.items.map((item) => item.id));
    const granted = Object.fromEntries(ids.map((id) => [id, true]));

    expect(navigationForModules(granted).flatMap((category) => category.items.map((item) => item.id))).toEqual(ids);
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

    expect(labels).toEqual(["Projects", "Tickets", "To Do", "Services", "Forms"]);
    expect(visible.map((category) => category.label)).toEqual(["Activity", "Setup"]);
  });

  it("treats an absent module as denied rather than visible", () => {
    expect(navigationForModules({}).flatMap((category) => category.items)).toEqual([]);
  });
});
