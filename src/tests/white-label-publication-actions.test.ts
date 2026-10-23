import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), quick: vi.fn(), admin: vi.fn(), settings: vi.fn(), repository: vi.fn(), preflight: vi.fn(), publish: vi.fn(), reconcile: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: mocks.context }));
vi.mock("../lib/qa/local-ui-bypass", () => ({ isLocalQuickAccessSession: mocks.quick }));
vi.mock("../repositories/white-label-publication-repository", () => ({ WhiteLabelPublicationRepository: class { constructor(client: unknown) { mocks.repository(client); } } }));
vi.mock("../services/white-label-publication-service", () => ({ WhiteLabelPublicationService: class { preflight = mocks.preflight; publish = mocks.publish; reconcile = mocks.reconcile; } }));
import { preflightWhiteLabelPublicationAction, publishWhiteLabelDraftAction, reconcileWhiteLabelPublicationAction } from "../app/actions/white-label-publication";
import { PermissionDeniedError } from "../lib/errors/application-error";

const actorId = "f0000000-0000-4000-8000-000000004201";
const input = { tenantId: "f0000000-0000-4000-8000-000000004202", sourceDraftRevision: 3, expectedPublicationRevision: 0, requestId: "f0000000-0000-4000-8000-000000004203", reason: "Reviewed saved branding" };
const client = {};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ actor: { id: actorId }, client, services: { permissions: { isPlatformAdmin: mocks.admin, requireModuleAccess: mocks.settings } } });
  mocks.quick.mockResolvedValue(false); mocks.admin.mockResolvedValue(true);
});

describe("publication action authority", () => {
  it.each(["quick", "admin", "settings", "actor"])("refuses %s before constructing any publication repository", async (boundary) => {
    if (boundary === "quick") mocks.quick.mockResolvedValue(true);
    if (boundary === "admin") mocks.admin.mockResolvedValue(false);
    if (boundary === "settings") mocks.settings.mockRejectedValue(new PermissionDeniedError());
    const scope = boundary === "actor" ? "f0000000-0000-4000-8000-000000004204" : actorId;
    for (const operation of [() => preflightWhiteLabelPublicationAction(scope, { tenantId: input.tenantId, sourceDraftRevision: 3, expectedPublicationRevision: 0 }), () => publishWhiteLabelDraftAction(scope, input), () => reconcileWhiteLabelPublicationAction(scope, input)]) {
      await expect(operation()).resolves.toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
    }
    expect(mocks.repository).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("uses the existing verified user client and passes exact publish/reconcile input to the producer", async () => {
    mocks.reconcile.mockResolvedValue({ outcome: "not_found" });
    await expect(reconcileWhiteLabelPublicationAction(actorId, input)).resolves.toEqual({ ok: true, data: { outcome: "not_found" } });
    expect(mocks.repository).toHaveBeenCalledWith(client);
    expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith(input);
    expect(mocks.settings).toHaveBeenCalledWith("settings");
    mocks.publish.mockRejectedValue(new PermissionDeniedError());
    await expect(publishWhiteLabelDraftAction(actorId, input)).resolves.toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(input);
  });
  it("keeps transport errors explicit and does not substitute a successful empty preflight", async () => {
    mocks.preflight.mockRejectedValue(new Error("Transport details must remain private"));
    await expect(preflightWhiteLabelPublicationAction(actorId, { tenantId: input.tenantId, sourceDraftRevision: 3, expectedPublicationRevision: 0 })).resolves.toEqual({ ok: false, error: { code: "DATABASE_ERROR", message: "The operation failed." } });
  });
});
