import { describe, expect, it, vi } from "vitest";
import { WhiteLabelPublicationService } from "../services/white-label-publication-service";
import type { WhiteLabelPublicationRepository } from "../repositories/white-label-publication-repository";
import { ValidationError } from "../lib/errors/application-error";

describe("publication service", () => {
  function fixture() {
    const repository = { getRuntimeConfiguration: vi.fn(), preflight: vi.fn(), publish: vi.fn(), reconcile: vi.fn() };
    return { repository, service: new WhiteLabelPublicationService({ repository: repository as unknown as WhiteLabelPublicationRepository }) };
  }
  const input = { tenantId: "f0000000-0000-4000-8000-000000004101", sourceDraftRevision: 1, expectedPublicationRevision: 0,
    requestId: "a0000000-0000-4000-8000-000000004101", reason: "Reviewed" };
  it("validates both writes and read-only reconciliation before repository access", () => {
    const { service, repository } = fixture();
    for (const method of ["publish", "reconcile"] as const) {
      expect(() => service[method]({ ...input, sourceDraftRevision: 0 })).toThrow(ValidationError);
      expect(repository[method]).not.toHaveBeenCalled();
    }
  });
  it("binds canonical inputs once without generating a replacement UUID", () => {
    const { service, repository } = fixture();
    service.publish({ ...input, reason: "  Reviewed  " });
    service.reconcile(input);
    expect(repository.publish).toHaveBeenCalledExactlyOnceWith(input);
    expect(repository.reconcile).toHaveBeenCalledExactlyOnceWith(input);
  });
  it("keeps preflight advisory and runtime reads separate from publication", () => {
    const { service, repository } = fixture();
    const preflight = { tenantId: input.tenantId, sourceDraftRevision: 1, expectedPublicationRevision: 0 };
    service.preflight(preflight);
    service.getRuntimeConfiguration();
    expect(repository.preflight).toHaveBeenCalledExactlyOnceWith(preflight);
    expect(repository.getRuntimeConfiguration).toHaveBeenCalledExactlyOnceWith();
    expect(repository.publish).not.toHaveBeenCalled();
  });
});
