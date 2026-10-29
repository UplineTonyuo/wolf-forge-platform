import type { FormAssignmentSummary } from "./schema";

export function assignedFormTitle(assignment: Pick<FormAssignmentSummary, "form_type" | "service_name" | "title">): string {
  return assignment.form_type === "intake" && assignment.service_name?.trim()
    ? assignment.service_name
    : assignment.title;
}
