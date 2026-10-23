import { afterEach, describe, expect, it, vi } from "vitest";

const { gate, quickAccess, isPlatformAdmin, getDraft, saveDraft, listDrafts, requireModuleAccess, getInternalContext } = vi.hoisted(() => {
  const isPlatformAdmin = vi.fn();
  const getDraft = vi.fn();
  const saveDraft = vi.fn();
  const listDrafts = vi.fn();
  const requireModuleAccess = vi.fn();
  return {
    gate: vi.fn(),
    quickAccess: vi.fn(),
    isPlatformAdmin,
    getDraft,
    saveDraft,
    listDrafts,
    requireModuleAccess,
    getInternalContext: vi.fn(async () => ({
      client: {},
      services: { permissions: { isPlatformAdmin, requireModuleAccess }, whiteLabel: { getDraft, saveDraft, listDrafts } },
    })),
  };
});

vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("../lib/qa/local-ui-bypass", () => ({ localUiQaBypassEnabled: gate, isLocalQuickAccessSession: quickAccess }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext }));

import { getWhiteLabelDraftAction, saveWhiteLabelDraftAction, listWhiteLabelDraftsAction } from "../app/actions/white-label";

afterEach(() => vi.clearAllMocks());

const TENANT = "f0f0f0f0-0000-4000-8000-000000002601";

describe("White Label draft actions (WL-2.33)", () => {
  it("preserves approved hosted-shaped access with the full Platform Admin and Settings boundary", async () => {
    gate.mockResolvedValue(false);
    quickAccess.mockResolvedValue(false);
    isPlatformAdmin.mockResolvedValue(true);
    getDraft.mockResolvedValue({ tenantId: TENANT });
    saveDraft.mockResolvedValue({ revision: 1, updatedAt: "t" });
    listDrafts.mockResolvedValue([]);
    await expect(getWhiteLabelDraftAction(TENANT)).resolves.toMatchObject({ ok: true });
    await expect(saveWhiteLabelDraftAction({})).resolves.toMatchObject({ ok: true });
    await expect(listWhiteLabelDraftsAction()).resolves.toMatchObject({ ok: true });
    expect(gate).not.toHaveBeenCalled();
    expect(requireModuleAccess).toHaveBeenCalledTimes(3);
    expect(requireModuleAccess).toHaveBeenCalledWith("settings");
  });

  it("refuse the passwordless Quick Access session even when it holds the entitlement", async () => {
    gate.mockResolvedValue(true);
    quickAccess.mockResolvedValue(true);
    isPlatformAdmin.mockResolvedValue(true);
    await expect(saveWhiteLabelDraftAction({ tenantId: TENANT })).resolves.toMatchObject({
      ok: false,
      error: { code: "PERMISSION_DENIED" },
    });
    expect(saveDraft).not.toHaveBeenCalled();
    await expect(listWhiteLabelDraftsAction()).resolves.toMatchObject({ok:false,error:{code:"PERMISSION_DENIED"}});
    expect(listDrafts).not.toHaveBeenCalled();
  });

  it("refuse a session without the Platform Admin entitlement (re-checked on every call)", async () => {
    gate.mockResolvedValue(true);
    quickAccess.mockResolvedValue(false);
    isPlatformAdmin.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    getDraft.mockResolvedValue({ tenantId: TENANT });
    await expect(getWhiteLabelDraftAction(TENANT)).resolves.toMatchObject({ ok: true });
    await expect(getWhiteLabelDraftAction(TENANT)).resolves.toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
    expect(getDraft).toHaveBeenCalledOnce();
  });

  it("pass the Platform Admin's input to the service unchanged", async () => {
    gate.mockResolvedValue(true);
    quickAccess.mockResolvedValue(false);
    isPlatformAdmin.mockResolvedValue(true);
    saveDraft.mockResolvedValue({ revision: 4, updatedAt: "t" });
    const input = { tenantId: TENANT, expectedRevision: 3 };
    await expect(saveWhiteLabelDraftAction(input)).resolves.toEqual({ ok: true, data: { revision: 4, updatedAt: "t" } });
    expect(saveDraft).toHaveBeenCalledExactlyOnceWith(input);
  });
  it("rechecks entitlement before discovering summaries and maps read failures safely",async()=>{
    gate.mockResolvedValue(true);quickAccess.mockResolvedValue(false);isPlatformAdmin.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    listDrafts.mockResolvedValue([]);await expect(listWhiteLabelDraftsAction()).resolves.toEqual({ok:true,data:[]});
    await expect(listWhiteLabelDraftsAction()).resolves.toMatchObject({ok:false,error:{code:"PERMISSION_DENIED"}});expect(listDrafts).toHaveBeenCalledOnce();
  });
  it("refuses Settings denial before any draft write", async () => {
    quickAccess.mockResolvedValue(false);
    isPlatformAdmin.mockResolvedValue(true);
    const { PermissionDeniedError } = await import("../lib/errors/application-error");
    requireModuleAccess.mockRejectedValueOnce(new PermissionDeniedError());
    await expect(saveWhiteLabelDraftAction({ tenantId: TENANT })).resolves.toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
    expect(saveDraft).not.toHaveBeenCalled();
  });
});
