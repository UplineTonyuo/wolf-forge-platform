import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCouponAccessAction } from "../app/actions/coupons";

const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: mocks.context }));

describe("Coupon access observation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({ user: { canManageCoupons: false }, client: { rpc: mocks.rpc } });
  });
  it("keeps an errored permission projection separate from a successful current grant", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    expect(await loadCouponAccessAction()).toEqual({ ok: true, allowed: true });
    expect(mocks.rpc).toHaveBeenCalledWith("app_has_permission", { p_permission_key: "coupons.manage" });
  });
  it("does not turn a returned transport error into authoritative revocation", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "", message: "Failed to fetch" } });
    expect(await loadCouponAccessAction()).toEqual({ ok: false, denied: false });
  });
  it("returns a successful current denial", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await loadCouponAccessAction()).toEqual({ ok: true, allowed: false });
  });
  it("retains an explicit database authorization denial", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Permission denied" } });
    expect(await loadCouponAccessAction()).toEqual({ ok: false, denied: true });
  });
});
