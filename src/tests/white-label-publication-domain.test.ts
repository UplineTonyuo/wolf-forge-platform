import { describe, expect, it } from "vitest";
import { DatabaseError } from "../lib/errors/application-error";
import { decodePublicationPreflight, decodePublicationReconciliation, decodePublishWhiteLabelResult, decodeRuntimeWhiteLabelConfiguration,
  publishWhiteLabelSchema, staticPublicationBlocker } from "../domain/white-label/publication";

const tenantId = "f0000000-0000-4000-8000-000000004101";
const configuration = { tenantId, publicationRevision: 1, sourceDraftRevision: 2, displayName: "Northwind",
  primaryColor: "#000d51", accentColor: "#a8832e", moduleKeys: ["services"], publishedAt: "2026-10-15T01:00:00.000001+00:00" };
const receipt = { configuration, requestId: "a0000000-0000-4000-8000-000000004101", expectedPublicationRevision: 0,
  publishedBy: "20000000-0000-4000-8000-000000004101", reason: "Reviewed" };
const preflight = { tenantId, sourceDraftRevision: 2, currentDraftRevision: 2, expectedPublicationRevision: 0,
  currentPublicationRevision: 0, candidate: { displayName: "Northwind", primaryColor: "#000d51", accentColor: "#a8832e", moduleKeys: ["services"] },
  publishable: true, blockers: [] };

describe("frozen publication wire decoding", () => {
  it("decodes all three explicit runtime states", () => {
    for (const value of [{ kind: "published", configuration }, { kind: "legacy_modules", tenantId, publicationRevision: 3, moduleKeys: ["services"] },
      { kind: "unpublished", tenantId, publicationRevision: 0 }]) expect(decodeRuntimeWhiteLabelConfiguration(value)).toEqual(value);
  });
  it.each([null, undefined, [], {}, { kind: "future" }, { kind: "unpublished", tenantId, publicationRevision: 1 },
    { kind: "unpublished", tenantId, publicationRevision: 0, configuration }, { kind: "published", configuration: { ...configuration, primaryColor: "red" } },
    { kind: "published", configuration: { ...configuration, moduleKeys: ["services", "services"] } },
    { kind: "published", configuration: { ...configuration, moduleKeys: ["tickets", "services"] } },
    { kind: "published", configuration: { ...configuration, moduleKeys: ["services", "todo"] } },
    { kind: "published", configuration: { ...configuration, moduleKeys: [] } },
    { kind: "published", configuration: { ...configuration, moduleKeys: ["projects", "services"] } },
    { kind: "published", configuration: { ...configuration, publishedAt: "yesterday" } },
    { kind: "published", configuration: { ...configuration, displayName: " X " } },
    { kind: "published", configuration: { ...configuration, displayName: "bad\u0000" } },
    { kind: "published", configuration: { ...configuration, sourceDraftRevision: 0 } },
    { kind: "legacy_modules", tenantId, publicationRevision: 1, moduleKeys: ["forms"] },
  ])("refuses malformed data instead of returning defaults: %j", (value) => {
    expect(() => decodeRuntimeWhiteLabelConfiguration(value)).toThrow(DatabaseError);
  });
  it("accepts complete receipts and explicit absent reconciliation", () => {
    expect(decodePublishWhiteLabelResult({ outcome: "published", receipt }).receipt).toEqual(receipt);
    expect(decodePublicationReconciliation({ outcome: "applied", receipt })).toEqual({ outcome: "applied", receipt });
    expect(decodePublicationReconciliation({ outcome: "not_found" })).toEqual({ outcome: "not_found" });
  });
  it("rejects mismatched receipt revisions and ambiguous reconciliation", () => {
    expect(() => decodePublishWhiteLabelResult({ outcome: "already_applied", receipt: { ...receipt, expectedPublicationRevision: 5 } })).toThrow(DatabaseError);
    expect(() => decodePublicationReconciliation({ outcome: "not_found", receipt })).toThrow(DatabaseError);
  });
  it("requires truthful preflight flags, static policy and stale-revision blockers", () => {
    expect(decodePublicationPreflight(preflight)).toEqual(preflight);
    const refused = { ...preflight, candidate: { ...preflight.candidate, moduleKeys: [] }, publishable: false, blockers: [{ code: "SERVICES_REQUIRED" }] };
    expect(decodePublicationPreflight(refused)).toEqual(refused);
    for (const value of [{ ...refused, publishable: true }, { ...refused, blockers: [] }, { ...preflight, currentDraftRevision: 3 },
      { ...preflight, currentPublicationRevision: 1 }, { ...preflight, candidate: null }, { ...preflight, publishable: false },
      { ...refused, blockers: [{ code: "SERVICES_REQUIRED" }, { code: "SERVICES_REQUIRED" }] }]) {
      expect(() => decodePublicationPreflight(value)).toThrow(DatabaseError);
    }
  });
  it("accepts an unsaved draft only as a blocked null candidate", () => {
    expect(decodePublicationPreflight({ ...preflight, currentDraftRevision: 0, candidate: null, publishable: false,
      blockers: [{ code: "DRAFT_NOT_SAVED" }, { code: "STALE_DRAFT" }] }).publishable).toBe(false);
  });
});

describe("publication request boundary", () => {
  const input = { tenantId, sourceDraftRevision: 2, expectedPublicationRevision: 0, requestId: receipt.requestId, reason: "Reviewed" };
  it("canonicalizes UUID case and exactly the database's space trimming", () => {
    expect(publishWhiteLabelSchema.parse({ ...input, tenantId: tenantId.toUpperCase(), reason: "  Reviewed  " })).toEqual(input);
    expect(publishWhiteLabelSchema.parse({ ...input, reason: "\tReviewed\t" }).reason).toBe("\tReviewed\t");
    expect(publishWhiteLabelSchema.parse({ ...input, reason: "🌿".repeat(500) }).reason).toHaveLength(1000);
  });
  it.each([{ sourceDraftRevision: 0 }, { sourceDraftRevision: 2_147_483_648 }, { expectedPublicationRevision: 2_147_483_647 },
    { expectedPublicationRevision: -1 }, { sourceDraftRevision: 1.5 }, { reason: "  " }, { reason: "x".repeat(501) },
    { requestId: "invalid" }, { publishedBy: receipt.publishedBy }])("refuses invalid or caller-controlled authority: %j", (change) => {
    expect(publishWhiteLabelSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });
  it("does not auto-enable Services or discard module dependencies", () => {
    expect(staticPublicationBlocker([])).toBe("SERVICES_REQUIRED");
    expect(staticPublicationBlocker(["services", "projects"])).toBe("INVALID_MODULE_POLICY");
    expect(staticPublicationBlocker(["services", "subscriptions"])).toBe("INVALID_MODULE_POLICY");
    expect(staticPublicationBlocker(["services"])).toBeNull();
  });
});
