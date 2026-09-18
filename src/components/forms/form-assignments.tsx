"use client";

import { LoaderCircle, Send } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignFormAction } from "../../app/actions/forms";
import type { FormAssignmentSummary } from "../../domain/forms/schema";
import { formatDate } from "../../lib/format";
import { titleCaseState } from "../../lib/forms/presentation";
import styles from "./forms.module.css";

export type AssignmentOption = { id: string; label: string; detail: string };

export function FormAssignments({
  formId,
  formType,
  assignments,
  options,
}: {
  formId: string;
  formType: "intake" | "onboarding";
  assignments: FormAssignmentSummary[];
  options: AssignmentOption[];
}) {
  const router = useRouter();
  const [targetId, setTargetId] = useState("");
  const [required, setRequired] = useState(true);
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requestId = useMemo(() => crypto.randomUUID(), []);

  function assign() {
    if (!targetId || pending) return;
    startTransition(async () => {
      setError(null);
      const context = formType === "intake"
        ? { order_id: targetId, required, due_at: dueAt ? new Date(`${dueAt}T17:00:00`).toISOString() : null }
        : { client_profile_id: targetId, required, due_at: dueAt ? new Date(`${dueAt}T17:00:00`).toISOString() : null };
      const result = await assignFormAction(formId, { request_id: requestId, context });
      if (!result.ok) setError(result.error);
      else { setTargetId(""); router.refresh(); }
    });
  }

  return <div className={styles.assignmentRoot}>
    <section className={styles.assignPanel}><header><span>New assignment</span><h2>{formType === "intake" ? "Assign to a Project" : "Assign to a client"}</h2><p>{formType === "intake" ? "Only Projects whose Service is linked to this Form can be assigned." : "The backend derives company scope from the selected client profile."}</p></header><div className={styles.assignFields}><label><span>{formType === "intake" ? "Project" : "Client"}</span><select value={targetId} onChange={(event) => setTargetId(event.currentTarget.value)}><option value="">Choose {formType === "intake" ? "a Project" : "a client"}</option>{options.map((option) => <option value={option.id} key={option.id}>{option.label} — {option.detail}</option>)}</select></label><label><span>Due date</span><input type="date" value={dueAt} onChange={(event) => setDueAt(event.currentTarget.value)} /></label><label className={styles.toggle}><input type="checkbox" checked={required} onChange={(event) => setRequired(event.currentTarget.checked)} /><span><strong>Required</strong><small>Show this Form in the client’s required queue.</small></span></label><button className="button-primary" type="button" aria-busy={pending || undefined} disabled={!targetId || pending} onClick={assign}>{pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Send aria-hidden="true" />}Assign Form</button></div>{error ? <p className={styles.actionError} role="alert">{error}</p> : null}</section>
    <section className={styles.assignmentHistory}><header><div><span>Assignment history</span><h2>{assignments.length} {assignments.length === 1 ? "assignment" : "assignments"}</h2></div></header>{assignments.length === 0 ? <p className={styles.sectionEmpty}>This Form has not been assigned yet.</p> : <div className={styles.tableWrap}><table><thead><tr><th>Client / Company</th><th>Project</th><th>Version</th><th>Required</th><th>Due</th><th>Status</th></tr></thead><tbody>{assignments.map((assignment) => <tr key={assignment.assignment_id}><td><strong>{assignment.client_name ?? assignment.company_name}</strong><span className={styles.cellSubline}>{assignment.company_name}</span></td><td>{assignment.order_title ?? "—"}{assignment.order_number ? <span className={styles.cellSubline}>Project #{assignment.order_number}</span> : null}</td><td>Version {assignment.version_number}</td><td>{assignment.required ? "Yes" : "No"}</td><td>{formatDate(assignment.due_at)}</td><td><span className={styles.status} data-state={assignment.status}>{titleCaseState(assignment.status)}</span></td></tr>)}</tbody></table></div>}</section>
  </div>;
}
