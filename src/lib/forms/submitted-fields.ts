import type { FormSubmissionDetail } from "../../domain/forms/schema";

export type SubmittedField = FormSubmissionDetail["values"][number];

export function hasSubmittedFieldLabel(label: string) {
  return !["", "no name", "(no name)"].includes(label.trim().toLowerCase());
}

export function visibleSubmittedFields(fields: SubmittedField[]) {
  return fields.filter((field) => hasSubmittedFieldLabel(field.label)
    && !["secret", "hidden", "password", "html", "break", "pagebreak", "captcha"].includes(field.field_type))
    .sort((a, b) => a.sort_order - b.sort_order);
}
