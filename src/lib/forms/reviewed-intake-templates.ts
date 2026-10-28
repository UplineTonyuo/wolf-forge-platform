import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createFormSchema, type CreateFormInput } from "../../domain/forms/schema";

const bundleRoot = join(process.cwd(), "data/intake-forms/20261028");
const manifestSchema = z.object({
  templates: z.array(z.object({
    file: z.string().regex(/^(?:intake|service)-\d+\.json$/u),
    canonical_key: z.string(),
    status: z.literal("content_review_passed_pending_workflow_and_publication"),
    services: z.array(z.uuid()).min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })).length(37),
});

export type ReviewedIntakeTemplateOption = { file: string; label: string; fieldCount: number; serviceCount: number };
export type ReviewedIntakeTemplate = Omit<CreateFormInput, "request_id"> & { file: string };

export async function loadReviewedIntakeTemplates(services: { id: string }[], requestedFile?: string) {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(join(bundleRoot, "manifest.json"), "utf8")));
  if (new Set(manifest.templates.map((entry) => entry.file)).size !== 37 || new Set(manifest.templates.flatMap((entry) => entry.services)).size !== 59) {
    throw new Error("Reviewed intake catalogue is invalid.");
  }
  const available = new Set(services.map((service) => service.id));
  const options: ReviewedIntakeTemplateOption[] = [];
  let selected: ReviewedIntakeTemplate | null = null;
  for (const entry of manifest.templates) {
    if (!entry.services.every((id) => available.has(id))) continue;
    const bytes = await readFile(join(bundleRoot, "drafts", entry.file));
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("Reviewed intake template integrity check failed.");
    const payload = createFormSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (payload.form_type !== "intake" || payload.canonical_key !== entry.canonical_key || JSON.stringify(payload.definition.service_links.map((link) => link.service_id)) !== JSON.stringify(entry.services)) {
      throw new Error("Reviewed intake template does not match its catalogue entry.");
    }
    if (payload.definition.fields.some((field) => field.service_links.some((link) => !available.has(link.service_id)))) continue;
    options.push({ file: entry.file, label: payload.definition.name, fieldCount: payload.definition.fields.length, serviceCount: entry.services.length });
    if (requestedFile === entry.file) selected = { file: entry.file, form_type: payload.form_type, canonical_key: payload.canonical_key, definition: payload.definition };
  }
  return { options, selected };
}
