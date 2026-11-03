import { describe, expect, it } from "vitest";
import { portalNavigationFor, portalTitleForPath, portalRouteIsCurrent } from "../components/account/portal-nav-registry";

describe("consolidated Orders navigation", () => {
  it("keeps Forms-only clients' assigned forms reachable through Orders", () => {
    const items = portalNavigationFor({ portal_forms: true }).flatMap((group) => group.items);
    expect(items.find((item) => item.label === "Orders")?.route).toBe("/account/projects");
    expect(items.some((item) => item.id === "portal_forms")).toBe(false);
    const orders = items.find((item) => item.id === "portal_projects")!;
    expect(portalRouteIsCurrent(orders, "/account/onboarding/assignment")).toBe(true);
  });
  it("does not invent an Orders grant for accounts with neither module", () => {
    expect(portalNavigationFor({}).flatMap((group) => group.items).some((item) => item.id === "portal_projects")).toBe(false);
  });
  it("labels both saved Orders and legacy assigned-form routes consistently", () => {
    expect(portalTitleForPath("/account/projects/order")).toBe("Orders");
    expect(portalTitleForPath("/account/onboarding/assignment")).toBe("Orders");
  });
});
