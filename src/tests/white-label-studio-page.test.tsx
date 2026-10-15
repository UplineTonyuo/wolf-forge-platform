import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ local: vi.fn(), quick: vi.fn(), admin: vi.fn(), settings: vi.fn(), tenants: vi.fn(), draft: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("STUDIO_NOT_FOUND"); } }));
vi.mock("../lib/qa/local-ui-bypass", () => ({ localUiQaBypassEnabled: mocks.local, isLocalQuickAccessSession: mocks.quick }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: async () => ({ actor: { id: "f0000000-0000-4000-8000-000000004201" }, services: {
  permissions: { isPlatformAdmin: mocks.admin, requireModuleAccess: mocks.settings },
  whiteLabel: { listTenants: mocks.tenants, getDraft: mocks.draft },
} }) }));
import StudioPage from "../app/(internal)/white-label/page";

const tenant = { id: "c70b73ea-99d9-4c1f-9b0c-f7087a724859", displayName: "QA Tenant", status: "active", draftRevision: 4 };
const open = (id?: string) => StudioPage({ searchParams: Promise.resolve({ tenant: id }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.local.mockResolvedValue(true); mocks.quick.mockResolvedValue(false); mocks.admin.mockResolvedValue(true);
  mocks.settings.mockResolvedValue(undefined); mocks.tenants.mockResolvedValue([tenant]); mocks.draft.mockResolvedValue({ revision: 4 });
});

describe("Studio page resource and denial boundary", () => {
  it("preserves approved hosted-shaped access with verified actor-scoped recovery", async () => {
    mocks.local.mockResolvedValue(false);
    const page = await open(tenant.id);
    expect(page.props.actorId).toBe("f0000000-0000-4000-8000-000000004201");
    expect(page.key).toBe(page.props.actorId);
    expect(mocks.local).not.toHaveBeenCalled();
    expect(mocks.settings).toHaveBeenCalledWith("settings");
  });
  it("excludes Quick Access before Settings or draft reads", async () => {
    mocks.quick.mockResolvedValue(true);
    await expect(open(tenant.id)).rejects.toThrow("STUDIO_NOT_FOUND");
    expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.tenants).not.toHaveBeenCalled();
  });
  it("ordinary staff receives the unavailable boundary instead of a Settings permission error", async () => {
    mocks.admin.mockResolvedValue(false); mocks.settings.mockRejectedValue(new Error("Settings denied"));
    await expect(open(tenant.id)).rejects.toThrow("STUDIO_NOT_FOUND");
    expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.tenants).not.toHaveBeenCalled(); expect(mocks.draft).not.toHaveBeenCalled();
  });
  it("still requires Settings access for an entitled Platform Admin", async () => {
    mocks.settings.mockRejectedValue(new Error("Settings denied"));
    await expect(open(tenant.id)).rejects.toThrow("Settings denied");
    expect(mocks.settings).toHaveBeenCalledWith("settings"); expect(mocks.tenants).not.toHaveBeenCalled();
  });
  it("loads only the authorized requested Tenant's persisted revision", async () => {
    const page = await open(tenant.id);
    expect(mocks.draft).toHaveBeenCalledExactlyOnceWith(tenant.id); expect(page.props.initialDraft.revision).toBe(4);
  });
  it("an unknown resource query never causes a draft read", async () => {
    const page = await open("c70b73ea-99d9-4c1f-9b0c-f7087a724860");
    expect(mocks.draft).not.toHaveBeenCalled(); expect(page.props.initialDraft).toBeNull();
  });
});
