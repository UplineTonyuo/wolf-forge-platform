import type { FormSubmissionDetail } from "../../domain/forms/schema";
import type { SubmittedField } from "../../lib/forms/submitted-fields";

export const orderId = "20000000-0000-4000-8000-000000000001";
export const companyId = "20000000-0000-4000-8000-000000000002";
export function answer(value: SubmittedField["value"], field_type = "text", sort_order = 0): SubmittedField {
  return { stable_field_key: `field-${sort_order}`, label: `Frozen label ${sort_order}`, field_type, sort_order, value };
}
export function response(id = "20000000-0000-4000-8000-000000000003", values = [answer("Synthetic answer")]): FormSubmissionDetail {
  return {
    submission: {
      id, form_id: "20000000-0000-4000-8000-000000000004", form_version_id: "20000000-0000-4000-8000-000000000005",
      form_assignment_id: null, company_id: companyId, client_profile_id: null, order_id: orderId,
      revision_number: 1, status: "accepted", submitted_at: "2026-10-28T10:00:00Z", submitted_by_profile_id: null,
      supersedes_submission_id: null, root_submission_id: id, provenance: {}, orchestration_status: "not_applicable", orchestration_type: null,
    }, values,
  };
}
