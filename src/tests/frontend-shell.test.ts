import { describe, expect, it } from "vitest";
import { navigationCategories, titleForPath } from "../components/shell/nav-registry";

describe("Phase 3A navigation registry", () => {
  it("renders the complete Phase 3A.1 sidebar structure", () => {
    expect(navigationCategories.map((category) => category.label)).toEqual(["Activity", "Billing", "Marketing", "Setup"]);
    expect(navigationCategories.flatMap((category) => category.items.map((item) => item.label))).toEqual([
      "Projects", "Tickets", "Clients", "To Do", "Invoices", "Subscriptions", "Coupons", "Services", "Forms", "Settings",
    ]);
  });

  it("routes every sidebar item", () => {
    expect(navigationCategories.flatMap((category) => category.items.map((item) => item.route))).toEqual([
      "/orders", "/tickets", "/clients", "/todo", "/invoices", "/subscriptions", "/coupons", "/services", "/forms", "/settings",
    ]);
  });

  it("keeps user-facing project terminology in the shell", () => {
    expect(titleForPath("/orders")).toBe("Projects");
    expect(titleForPath("/orders/00000000-0000-0000-0000-000000000000")).toBe("Projects");
    expect(titleForPath("/todo")).toBe("To Do");
    expect(titleForPath("/coupons")).toBe("Coupons");
  });
});
