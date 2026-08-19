import { describe, expect, it } from "vitest";
import { navigationCategories, navigationForModules } from "../components/shell/nav-registry";
import { parseCouponFormData } from "../lib/coupons/form-data";

const SERVICE_ONE = "11111111-1111-4111-8111-111111111111";
const SERVICE_TWO = "22222222-2222-4222-8222-222222222222";

function couponForm(rules: unknown, overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values = {
    code: " save20 ",
    description: "Internal campaign",
    discount_type: "percentage",
    recurring_duration: "forever",
    is_active: "on",
    rules: JSON.stringify(rules),
    ...overrides,
  };
  Object.entries(values).forEach(([key, value]) => formData.set(key, value));
  return formData;
}

describe("Coupons admin form serialization", () => {
  it("serializes an explicit all-Services rule and normalizes the code", () => {
    const result = parseCouponFormData(couponForm([
      { discount_value: 20, applies_to_all: true, service_ids: [] },
    ]));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.code).toBe("SAVE20");
    expect(result.data.rules[0]).toEqual({
      discount_value: 20,
      applies_to_all: true,
      service_ids: [],
    });
  });

  it("preserves multiple selected Services and ordered rules", () => {
    const result = parseCouponFormData(couponForm([
      { discount_value: 20, applies_to_all: true, service_ids: [] },
      { discount_value: 30, applies_to_all: false, service_ids: [SERVICE_ONE, SERVICE_TWO] },
    ]));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.rules).toHaveLength(2);
    expect(result.data.rules[1]?.service_ids).toEqual([SERVICE_ONE, SERVICE_TWO]);
  });

  it("rejects percentage discounts over 100", () => {
    const result = parseCouponFormData(couponForm([
      { discount_value: 101, applies_to_all: true, service_ids: [] },
    ]));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.fieldErrors["rules.0.discount_value"]).toMatch(/at most 100/i);
  });

  it("rejects a specific-Services rule without a selection", () => {
    const result = parseCouponFormData(couponForm([
      { discount_value: 20, applies_to_all: false, service_ids: [] },
    ]));

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.fieldErrors["rules.0.service_ids"]).toMatch(/at least one Service/i);
  });

  it("accepts a non-negative fixed amount", () => {
    const result = parseCouponFormData(couponForm([
      { discount_value: 0, applies_to_all: true, service_ids: [] },
    ], { discount_type: "fixed" }));
    expect(result.success).toBe(true);
  });

  it("serializes redemption limits and an unambiguous expiry timestamp", () => {
    const result = parseCouponFormData(couponForm([
      { discount_value: 20, applies_to_all: true, service_ids: [] },
    ], {
      single_use_per_customer: "on",
      new_customers_only: "on",
      set_expiry: "on",
      expires_at: "2026-12-31T15:59:00.000Z",
      set_minimum_cart: "on",
      minimum_cart_amount: "100.00",
    }));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      single_use_per_customer: true,
      new_customers_only: true,
      expires_at: "2026-12-31T15:59:00.000Z",
      minimum_cart_amount: 100,
    });
  });
});

/** Mirrors what app_current_user_modules returns for a fully granted member. */
function modules(overrides: Record<string, boolean> = {}): Record<string, boolean> {
  const granted = Object.fromEntries(
    navigationCategories.flatMap((category) => category.items.map((item) => [item.id, true])),
  );

  return { ...granted, ...overrides };
}

describe("Coupons capability navigation", () => {
  it("removes Coupons without the coupons module", () => {
    const withoutCoupons = navigationForModules(modules({ coupons: false }));
    const labels = withoutCoupons.flatMap((category) => category.items.map((item) => item.label));
    expect(labels).not.toContain("Coupons");
  });

  /*
   * Marketing now carries Investment Intent as well, so losing Coupons alone no
   * longer empties the group. The group still disappears once nothing in it is
   * granted, which is the behaviour this ever meant to protect.
   */
  it("drops the Marketing group only once every module in it is denied", () => {
    const withoutCoupons = navigationForModules(modules({ coupons: false }));
    expect(withoutCoupons.map((category) => category.label)).toContain("Marketing");
    expect(
      withoutCoupons.flatMap((category) => category.items.map((item) => item.label)),
    ).toContain("Investment Intent");

    const withoutMarketing = navigationForModules(
      modules({ coupons: false, investment_intent: false }),
    );
    expect(withoutMarketing.map((category) => category.label)).not.toContain("Marketing");
  });

  it("shows Coupons when the coupons module is granted", () => {
    const labels = navigationForModules(modules()).flatMap((category) => category.items.map((item) => item.label));
    expect(labels).toContain("Coupons");
  });
});
