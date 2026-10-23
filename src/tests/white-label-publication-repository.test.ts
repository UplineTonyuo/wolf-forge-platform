import { describe, expect, it, vi } from "vitest";
import { WhiteLabelPublicationRepository } from "../repositories/white-label-publication-repository";
import type { UserMutationClient } from "../repositories/types";
import { ConflictError, DatabaseError, PermissionDeniedError } from "../lib/errors/application-error";

const input = { tenantId: "f0000000-0000-4000-8000-000000004101", sourceDraftRevision: 2, expectedPublicationRevision: 0,
  requestId: "a0000000-0000-4000-8000-000000004101", reason: "Reviewed" };
const receipt = { configuration: { tenantId: input.tenantId, publicationRevision: 1, sourceDraftRevision: 2, displayName: "Northwind",
  primaryColor: "#000d51", accentColor: "#a8832e", moduleKeys: ["services"], publishedAt: "2026-10-15T01:00:00Z" },
  requestId: input.requestId, expectedPublicationRevision: 0, publishedBy: "20000000-0000-4000-8000-000000004101", reason: "Reviewed" };
function fixture(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const repository = new WhiteLabelPublicationRepository({ rpc } as unknown as UserMutationClient);
  return { rpc, repository };
}

describe("publication repository", () => {
  it("reads only the current selected-Tenant runtime RPC without a caller Tenant argument", async () => {
    const value = { kind: "unpublished", tenantId: input.tenantId, publicationRevision: 0 };
    const { repository, rpc } = fixture(value);
    expect(await repository.getRuntimeConfiguration()).toEqual(value);
    expect(rpc.mock.calls).toEqual([["app_get_runtime_white_label_configuration"]]);
  });
  it("passes only exact request fields, never actor or draft payload", async () => {
    const { repository, rpc } = fixture({ outcome: "published", receipt });
    expect((await repository.publish(input)).receipt).toEqual(receipt);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("app_publish_white_label_draft", {
      p_tenant_id: input.tenantId, p_source_draft_revision: 2, p_expected_publication_revision: 0, p_request_id: input.requestId, p_reason: input.reason,
    });
  });
  it.each(["tenantId", "sourceDraftRevision"] as const)("refuses a receipt for a different %s", async (field) => {
    const configuration = { ...receipt.configuration, [field]: field === "tenantId" ? "f0000000-0000-4000-8000-000000004102" : 3 };
    const { repository } = fixture({ outcome: "published", receipt: { ...receipt, configuration } });
    await expect(repository.publish(input)).rejects.toBeInstanceOf(DatabaseError);
  });
  it.each(["requestId", "reason"] as const)("refuses a mismatched request %s", async (field) => {
    const changed = { ...receipt, [field]: field === "requestId" ? "a0000000-0000-4000-8000-000000004102" : "Other" };
    const { repository } = fixture({ outcome: "applied", receipt: changed });
    await expect(repository.reconcile(input)).rejects.toBeInstanceOf(DatabaseError);
  });
  it("propagates explicit absence without creating a publication or retry", async () => {
    const { repository, rpc } = fixture({ outcome: "not_found" });
    expect(await repository.reconcile(input)).toEqual({ outcome: "not_found" });
    expect(rpc.mock.calls[0]?.[0]).toBe("app_reconcile_white_label_publication");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each([[{ code: "WF409" }, ConflictError], [{ code: "42501" }, PermissionDeniedError], [{ message: "connection lost" }, DatabaseError]] as const)(
    "never converts request failure into success, absence or automatic retry: %j", async (error, kind) => {
      const { repository, rpc } = fixture(null, error);
      await expect(repository.publish(input)).rejects.toBeInstanceOf(kind);
      expect(rpc).toHaveBeenCalledTimes(1);
    });
  it("treats a missing success response as unknown, retaining caller request identity", async () => {
    const { repository, rpc } = fixture(null);
    await expect(repository.publish(input)).rejects.toBeInstanceOf(DatabaseError);
    rpc.mockResolvedValueOnce({ data: { outcome: "applied", receipt }, error: null });
    expect(await repository.reconcile(input)).toEqual({ outcome: "applied", receipt });
    expect(rpc.mock.calls.map((call) => call[1].p_request_id)).toEqual([input.requestId, input.requestId]);
  });
});
