import { afterEach, describe, expect, it, vi } from "vitest";

const { gate, quickAccess, isPlatformAdmin, settings, getDraft, saveDraft, listDrafts, getInternalContext } = vi.hoisted(() => {
  const isPlatformAdmin = vi.fn();
  const settings = vi.fn();
  const getDraft = vi.fn();
  const saveDraft = vi.fn();
  const listDrafts = vi.fn();
  return {
    gate: vi.fn(),
    quickAccess: vi.fn(),
    isPlatformAdmin,
    settings,
    getDraft,
    saveDraft,
    listDrafts,
    getInternalContext: vi.fn(async () => ({
      client: {},
      services: { permissions: { isPlatformAdmin, requireModuleAccess: (...args: unknown[]) => settings(...args) }, whiteLabel: { getDraft, saveDraft, listDrafts } },
    })),
  };
});

vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("../lib/qa/local-ui-bypass", () => ({ localUiQaBypassEnabled: gate, isLocalQuickAccessSession: quickAccess }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext }));

import { getWhiteLabelDraftAction, saveWhiteLabelDraftAction, listWhiteLabelDraftsAction } from "../app/actions/white-label";
import { PermissionDeniedError } from "../lib/errors/application-error";

afterEach(() => vi.clearAllMocks());

const TENANT = "f0f0f0f0-0000-4000-8000-000000002601";

describe("White Label draft actions (WL-2.33)", () => {
  it("requires Settings for every action, including a Platform Admin's direct request", async () => {
    quickAccess.mockResolvedValue(false);
    isPlatformAdmin.mockResolvedValue(true);
    settings.mockRejectedValueOnce(new PermissionDeniedError());
    await expect(saveWhiteLabelDraftAction({ tenantId: TENANT })).resolves.toMatchObject({ok:false,error:{code:"PERMISSION_DENIED"}});
    expect(settings).toHaveBeenCalledWith("settings");
    expect(saveDraft).not.toHaveBeenCalled();
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
});
