/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CouponAccessBoundary } from "../components/coupons/coupon-access-boundary";
import { mapDatabaseError } from "../lib/errors/map-database-error";

const access = vi.hoisted(() => vi.fn());
vi.mock("../app/actions/coupons", () => ({ loadCouponAccessAction: access }));
afterEach(cleanup);

describe("Coupon lifecycle presentation", () => {
  beforeEach(() => { access.mockReset(); });
  it("removes loaded management content when current authority is lost", async () => {
    access.mockResolvedValue({ ok: true, allowed: false });
    render(<CouponAccessBoundary><button>Manage saved Coupon</button></CouponAccessBoundary>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Existing financial discounts are preserved");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("retains content on transport errors without treating them as approval", async () => {
    access.mockRejectedValue(new Error("offline"));
    render(<CouponAccessBoundary><button>Manage saved Coupon</button></CouponAccessBoundary>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("button")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("does not restore content after a later successful access response", async () => {
    access.mockResolvedValueOnce({ ok: false, denied: true }).mockResolvedValue({ ok: true, allowed: true });
    render(<CouponAccessBoundary><button>Manage saved Coupon</button></CouponAccessBoundary>);
    await screen.findByRole("alert");
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("uses a fixed no-new-charge message for authoritative Coupon OFF denial", () => {
    expect(mapDatabaseError({ code: "42501", message: "WF_COUPONS_DISABLED", details: "private" }).toJSON()).toEqual({
      code: "PERMISSION_DENIED", message: "Coupons are unavailable. This request made no new purchase or payment.",
    });
  });
  it("explains exact historic preservation without returning database details", () => {
    const result = mapDatabaseError({ code: "42501", message: "Historic Coupon terms must be preserved exactly" }).toJSON();
    expect(result.code).toBe("PERMISSION_DENIED");
    expect(result.message).toContain("quantity, amount and currency unchanged");
  });
});
