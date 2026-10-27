import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFormSchema } from "../domain/forms/schema";

const root = resolve(import.meta.dirname, "../../data/intake-forms/20261028");
const read = (file: string) => JSON.parse(readFileSync(resolve(root, file), "utf8"));
const manifest = read("manifest.json") as { templates: { file: string; services: string[]; sha256: string }[] };
const catalog = read("service-catalog.json") as { id: string; source_service_id: number }[];
const review = read("new-drafts-review.json") as { policy_sha256: string; drafts: { file: string; source_service_id: number; woad_service_id: string }[] };
const drafts = manifest.templates.map((meta) => ({ meta, payload: createFormSchema.parse(read(`drafts/${meta.file}`)) }));

describe("unpublished intake draft package", () => {
  it("covers the captured 59-service catalog once without activating it", () => {
    expect(drafts).toHaveLength(37);
    expect(catalog).toHaveLength(59);
    const links = drafts.flatMap(({ payload }) => payload.definition.service_links);
    expect(links).toHaveLength(59);
    expect(new Set(links.map((link) => link.service_id)).size).toBe(59);
    expect(links.map((link) => link.service_id).sort()).toEqual(catalog.map((service) => service.id).sort());
    for (const { meta, payload } of drafts) {
      expect(payload.form_type).toBe("intake");
      expect(payload.definition.visibility).toBe("assigned");
      expect(payload.definition.type_config.automation).toBeUndefined();
      expect(payload.definition.type_config.reminder_days).toBe(0);
      expect(payload.definition.service_links.map((link) => link.service_id)).toEqual(meta.services);
      expect(createHash("sha256").update(readFileSync(resolve(root, "drafts", meta.file))).digest("hex")).toBe(meta.sha256);
    }
  });

  it("preserves the 12 reviewed service identities and exact drawn agreement", () => {
    expect(review.drafts.map((draft) => draft.source_service_id).sort((a, b) => a - b))
      .toEqual([418, 450, 571, 572, 573, 574, 575, 576, 577, 579, 580, 581]);
    for (const meta of review.drafts) {
      const draft = drafts.find((entry) => entry.meta.file === meta.file)!.payload;
      expect(draft.definition.service_links).toHaveLength(1);
      expect(draft.definition.service_links[0]!.service_id).toBe(meta.woad_service_id);
      const signatures = draft.definition.fields.filter((field) => field.field_type === "signature");
      expect(signatures).toHaveLength(1);
      expect(signatures[0]!.required).toBe(true);
      expect(signatures[0]!.settings.signature_mode).toBe("drawn");
      expect(createHash("sha256").update(signatures[0]!.help_html!).digest("hex")).toBe(review.policy_sha256);
      expect(draft.definition.fields.some((field) => field.field_type === "secret")).toBe(false);
    }
  });

  it("keeps source credential prompts disabled and non-required", () => {
    const protectedFields = drafts.flatMap(({ payload }) => payload.definition.fields).filter((field) => field.field_type === "secret");
    expect(protectedFields).toHaveLength(13);
    for (const field of protectedFields) {
      expect(field.settings.collection_mode).toBe("disabled");
      expect(field.required).toBe(false);
    }
  });
});
