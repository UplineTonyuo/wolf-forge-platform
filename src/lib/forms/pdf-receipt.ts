import { z } from "zod";

const answer = z.object({ stable_field_key: z.uuid(), label: z.string().max(500), field_type: z.string().max(40), sort_order: z.number().int(), value: z.json() }).strict();
const record = z.object({ id: z.uuid(), submitted_at: z.iso.datetime({ offset: true }), revision_number: z.number().int().positive(), values: z.array(answer).max(500) }).strict();
export const formPdfReceiptSchema = z.object({
  original: record,
  correction: record.nullable(),
  form: z.object({ id: z.uuid(), version_id: z.uuid(), version_number: z.number().int().positive(), schema_hash: z.string().max(200).nullable(), title: z.string().max(200), information_html: z.string().nullable(),
    fields: z.array(z.object({ key: z.uuid(), label: z.string().max(500), type: z.string().max(40), sort_order: z.number().int(), help_html: z.string().nullable(), html: z.string().nullable(), conditional: z.boolean(), display_only: z.boolean().default(false),
      options: z.array(z.object({ id: z.string().max(200), value: z.string().max(500).nullable(), label: z.string().max(500) }).strict()).max(500),
    }).strict()).max(500),
  }).strict(),
  files: z.array(z.object({ id: z.uuid(), name: z.string().max(255) }).strict()).max(40),
}).strict().superRefine((value, context) => {
  if (JSON.stringify(value).length > 350_000) context.addIssue({ code: "custom", message: "This submission is too large for a PDF download." });
});
export type FormPdfReceipt = z.infer<typeof formPdfReceiptSchema>;
export const FORM_PDF_MAX_BYTES = 8 * 1024 * 1024;
export function formPdfFilename(id: string) { return `form-submission-${z.uuid().parse(id)}.pdf`; }
