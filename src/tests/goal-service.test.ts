import { describe, expect, it, vi } from "vitest";
import { GoalService } from "../services/goal-service";
import type { GoalRepository } from "../repositories/goal-repository";
import type { TicketAttachmentStorageRepository } from "../repositories/ticket-attachment-storage-repository";
import type { UserMutationActor } from "../services/mutation-context";
vi.mock("../services/mutation-context", () => ({ requireVerifiedActor: (actor: { id?: string }) => { if (!actor?.id) throw new Error("Verified actor required"); } }));
const actor = { id: "a0000000-0000-4000-8000-000000000001" } as UserMutationActor;
const id = "a0000000-0000-4000-8000-000000000002";
const bytes = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
function setup() {
  const repository = { photoContext: vi.fn().mockResolvedValue({ tenant_id: id, updated_at: "revision", photo_path: "old" }), setPhoto: vi.fn(), get: vi.fn() };
  const storage = { storeOrConfirm: vi.fn().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(undefined), checksum: vi.fn().mockReturnValue("a".repeat(64)) };
  repository.setPhoto.mockImplementation(async (_id, photo) => ({ id, photo_path: photo.path }));
  return { repository, storage, service: new GoalService(repository as unknown as GoalRepository, storage as unknown as TicketAttachmentStorageRepository) };
}
describe("goal cover replacement", () => {
  it("authorizes before storing and does not remove an old cover on an interrupted upload", async () => {
    const x=setup(); x.storage.storeOrConfirm.mockRejectedValue(new Error("interrupted"));
    await expect(x.service.uploadPhoto(id,bytes,actor)).rejects.toThrow("interrupted");
    expect(x.repository.photoContext).toHaveBeenCalledWith(id,true);
    expect(x.repository.setPhoto).not.toHaveBeenCalled(); expect(x.storage.remove).not.toHaveBeenCalled();
  });
  it("rejects empty, invalid and oversized bytes before Storage work", async () => {
    for (const value of [new Uint8Array(),new Uint8Array([1,2,3]),new Uint8Array(2097153)]) {
      const x=setup(); await expect(x.service.uploadPhoto(id,value,actor)).rejects.toThrow();
      expect(x.storage.storeOrConfirm).not.toHaveBeenCalled();
    }
  });
  it("cleans the exact old cover only after a confirmed pointer update", async () => {
    const x=setup();
    await x.service.uploadPhoto(id,bytes,actor);
    expect(x.storage.remove).toHaveBeenCalledExactlyOnceWith("old");
    expect(x.repository.setPhoto.mock.invocationCallOrder[0]!).toBeLessThan(x.storage.remove.mock.invocationCallOrder[0]!);
  });
  it("reconciles a lost response if readback confirms the new cover", async () => {
    const x=setup();x.repository.setPhoto.mockRejectedValue(new Error("unknown"));
    x.repository.get.mockImplementation(async()=>({id,photo_path:x.repository.setPhoto.mock.calls[0]![1].path}));
    const result=await x.service.uploadPhoto(id,bytes,actor);expect(result.id).toBe(id);
  });
  it("retains a possibly committed cover after an unknown outcome", async () => {
    const x=setup();x.repository.setPhoto.mockRejectedValue(new Error("unknown"));x.repository.get.mockRejectedValue(new Error("unavailable"));
    await expect(x.service.uploadPhoto(id,bytes,actor)).rejects.toThrow("unknown");
    expect(x.storage.remove).not.toHaveBeenCalled();
  });
});
