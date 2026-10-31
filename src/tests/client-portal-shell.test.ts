import { describe, expect, it } from "vitest";
import {
  portalModuleGate,
  portalNavigationCategories,
  portalNavigationFor,
  portalRouteIsCurrent,
  portalTitleForPath,
  storeFolderRoute,
} from "../components/account/portal-nav-registry";
import { navigationCategories } from "../components/shell/nav-registry";
import type { ClientNavCounts } from "../domain/client-portal/summary";

const allPortalModules = {
  portal_dashboard: true,
  portal_projects: true,
  portal_tickets: true,
  portal_store: true,
  portal_forms: true,
  portal_invoices: true,
  portal_subscriptions: true,
};

const noCounts: ClientNavCounts = { onboarding: null, messages: null, projects: null };

describe("client portal navigation registry", () => {
  it("organises the rail around what the client needs to do", () => {
    expect(portalNavigationCategories.map((category) => category.label)).toEqual([
      "Overview",
      "Work",
      "Investments",
      "Billing",
      "Account",
    ]);

    expect(
      portalNavigationCategories.flatMap((category) => category.items.map((item) => item.label)),
    ).toEqual([
      "Dashboard",
      "Orders",
      "Inbox",
      "Reporting",
      "Investments",
      "Invoices",
      "Subscriptions",
      "Payment method",
      "Profile",
    ]);
  });

  it("routes every portal item inside /account", () => {
    const routes = portalNavigationCategories.flatMap((category) =>
      category.items.map((item) => item.route),
    );

    expect(routes).toEqual([
      "/account",
      "/account/projects",
      "/account/messages",
      "/account/reporting",
      "/account/store",
      "/account/invoices",
      "/account/subscriptions",
      "/account/payment-method",
      "/account/profile",
    ]);
    expect(routes.every((route) => route === "/account" || route.startsWith("/account/"))).toBe(true);
  });

  it("gates every gated item on a client-class portal_ module key", () => {
    const gates = portalNavigationCategories
      .flatMap((category) => category.items.map((item) => portalModuleGate(item.id)))
      .filter((gate): gate is string => gate !== null);

    expect(gates.every((gate) => gate.startsWith("portal_"))).toBe(true);

    // Payment method rides the existing invoices grant rather than inventing a
    // module key the database does not know about.
    expect(portalModuleGate("portal_payment_method")).toBe("portal_invoices");

    // Profile is self-service and therefore ungated: app_get_my_profile derives
    // the account from auth.uid() and is granted to every authenticated caller.
    expect(portalModuleGate("portal_profile")).toBeNull();
  });

  it("cannot express an internal route or module", () => {
    const portalIds = new Set(
      portalNavigationCategories.flatMap((category) => category.items.map((item) => item.id)),
    );
    const portalRoutes = new Set(
      portalNavigationCategories.flatMap((category) => category.items.map((item) => item.route)),
    );

    for (const internal of navigationCategories.flatMap((category) => category.items)) {
      expect(portalIds.has(internal.id as never)).toBe(false);
      expect(portalRoutes.has(internal.route)).toBe(false);
    }

    // Granting every internal module key buys a client nothing but the
    // ungated self-service Profile entry.
    const internalGrants = Object.fromEntries(
      navigationCategories.flatMap((category) => category.items.map((item) => [item.id, true])),
    );
    expect(
      portalNavigationFor(internalGrants).flatMap((category) =>
        category.items.map((item) => item.id),
      ),
    ).toEqual(["portal_profile"]);
  });

  it("treats an absent module as denied rather than visible", () => {
    expect(
      portalNavigationFor({}).flatMap((category) => category.items.map((item) => item.id)),
    ).toEqual(["portal_profile"]);
  });

  it("hides a denied module and drops the emptied group", () => {
    const visible = portalNavigationFor({
      ...allPortalModules,
      portal_store: false,
      portal_forms: false,
    });

    expect(visible.map((category) => category.label)).toEqual([
      "Overview",
      "Work",
      "Billing",
      "Account",
    ]);
    expect(visible.flatMap((category) => category.items.map((item) => item.label))).toEqual([
      "Dashboard",
      "Orders",
      "Inbox",
      "Invoices",
      "Subscriptions",
      "Payment method",
      "Profile",
    ]);
  });

  it("hides Payment method when the invoices module is denied", () => {
    const visible = portalNavigationFor({ ...allPortalModules, portal_invoices: false });
    const billing = visible.find((category) => category.id === "billing");

    expect(billing?.items.map((item) => item.label)).toEqual(["Subscriptions"]);
  });
});

describe("rail counts", () => {
  it("renders only real, non-zero counts", () => {
    const items = portalNavigationFor(allPortalModules, {
      onboarding: 2,
      messages: 0,
      projects: 3,
    }).flatMap((category) => category.items);

    const counted = items.filter((item) => item.count !== undefined);

    expect(counted.map((item) => [item.label, item.count])).toEqual([
      ["Orders", 3],
    ]);

    // Zero is not a badge; it is the absence of one.
    expect(items.find((item) => item.label === "Inbox")?.count).toBeUndefined();
  });

  it("marks only client-blocking counts as actionable", () => {
    const items = portalNavigationFor(allPortalModules, {
      onboarding: 1,
      messages: 1,
      projects: 1,
    }).flatMap((category) => category.items);

    const actionable = Object.fromEntries(
      items
        .filter((item) => item.count !== undefined)
        .map((item) => [item.label, item.countIsActionable]),
    );

    expect(actionable).toEqual({
      Orders: false,
      Inbox: true,
    });
  });

  it("renders no count at all when a module is denied", () => {
    // null means "this account has no such module", which is not zero.
    const items = portalNavigationFor(allPortalModules, noCounts).flatMap(
      (category) => category.items,
    );

    expect(items.every((item) => item.count === undefined)).toBe(true);
  });

  it("renders no count when counts could not be derived at all", () => {
    const items = portalNavigationFor(allPortalModules, null).flatMap(
      (category) => category.items,
    );

    expect(items.every((item) => item.count === undefined)).toBe(true);
  });
});

describe("service categories are not in the rail", () => {
  it("exposes no child list on any navigation item", () => {
    // The permanently expanded folder list is gone from the type itself, so a
    // future change cannot reintroduce it by passing data.
    const items = portalNavigationFor(allPortalModules).flatMap((category) => category.items);

    expect(items.every((item) => !("children" in item))).toBe(true);
  });

  it("keeps exactly one Investments entry rather than one row per category", () => {
    const services = portalNavigationFor(allPortalModules).find(
      (category) => category.id === "services",
    );

    expect(services?.items.map((item) => item.label)).toEqual(["Investments"]);
  });

  it("still encodes the folder id in the Store route used by the Store page", () => {
    expect(storeFolderRoute("a b&c")).toBe("/account/store?folder=a%20b%26c");
  });
});

describe("portal active-route resolution", () => {
  it("matches the dashboard exactly so it is not active on every portal page", () => {
    const dashboard = { route: "/account", exact: true };

    expect(portalRouteIsCurrent(dashboard, "/account")).toBe(true);
    expect(portalRouteIsCurrent(dashboard, "/account/store")).toBe(false);
    expect(portalRouteIsCurrent(dashboard, "/account/invoices")).toBe(false);
  });

  it("matches a section by prefix", () => {
    const store = { route: "/account/store" };

    expect(portalRouteIsCurrent(store, "/account/store")).toBe(true);
    expect(portalRouteIsCurrent(store, "/account/store/service-id")).toBe(true);
    expect(portalRouteIsCurrent(store, "/account/subscriptions")).toBe(false);
  });

  it("titles portal paths for the mobile top bar", () => {
    expect(portalTitleForPath("/account")).toBe("Dashboard");
    expect(portalTitleForPath("/account/projects")).toBe("Orders");
    expect(portalTitleForPath("/account/projects/abc")).toBe("Orders");
    expect(portalTitleForPath("/account/onboarding")).toBe("Orders");
    expect(portalTitleForPath("/account/messages/abc")).toBe("Inbox");
    expect(portalTitleForPath("/account/payment-method")).toBe("Payment method");
    expect(portalTitleForPath("/account/store/abc")).toBe("Investments");
    expect(portalTitleForPath("/account/unknown")).toBe("Wolf Forge");
  });
});
