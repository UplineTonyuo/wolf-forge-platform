import { beforeEach, describe, expect, it, vi } from "vitest";

const { gate, quickAccess, admin, context } = vi.hoisted(() => {
  const gate = vi.fn();
  const quickAccess = vi.fn();
  const admin = vi.fn();
  const context = vi.fn(async () => ({
    actor: {}, user: { modules: { settings: true } },
    services: { profile: { getMine: async () => null }, permissions: { isPlatformAdmin: admin } },
  }));
  return { gate, quickAccess, admin, context };
});
vi.mock("../components/shell/internal-shell", () => ({ InternalShell: () => null }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: context }));
vi.mock("../lib/qa/local-ui-bypass", () => ({ localUiQaBypassEnabled: gate, isLocalQuickAccessSession: quickAccess }));
import InternalLayout from "../app/(internal)/layout";

beforeEach(() => { vi.clearAllMocks(); gate.mockResolvedValue(true); quickAccess.mockResolvedValue(false); admin.mockResolvedValue(true); });

describe("Studio server presentation boundary", () => {
  async function visible() {
    const tree = await InternalLayout({ children: null });
    return tree.props.showWhiteLabel;
  }
  it("passes a separate server-authorized flag without changing Tenant permissions", async () => {
    expect(await visible()).toBe(true);
    expect((await context()).user.modules).toEqual({ settings: true });
  });

  it("retains the existing Settings access boundary without a White Label module key", async () => {
    const current = await context();
    context.mockResolvedValueOnce({ ...current, user: { modules: { settings: false } } });
    expect(await visible()).toBe(false);
    expect(admin).not.toHaveBeenCalled();
  });
  it("refuses Quick Access even when it holds Platform Admin entitlement", async () => {
    quickAccess.mockResolvedValue(true);
    expect(await visible()).toBe(false);
    expect(admin).not.toHaveBeenCalled();
  });
  it("hides the entry when the global entitlement is absent", async () => {
    admin.mockResolvedValue(false);
    expect(await visible()).toBe(false);
  });
  it("hides the entry when entitlement lookup fails", async () => {
    admin.mockRejectedValue(new Error("database unavailable"));
    expect(await visible()).toBe(false);
  });
});
