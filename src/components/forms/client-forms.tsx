import { ArrowRight, CheckCircle2, ClipboardList, Clock3 } from "lucide-react";
import Link from "next/link";
import type { FormAssignmentSummary } from "../../domain/forms/schema";
import { formatDate } from "../../lib/format";
import { titleCaseState } from "../../lib/forms/presentation";
import styles from "./forms.module.css";

export function ClientForms({ assignments }: { assignments: FormAssignmentSummary[] }) {
  const required = assignments.filter((assignment) => assignment.status === "assigned");
  const completed = assignments.filter((assignment) => assignment.status === "submitted");
  return <div className={styles.clientForms}>
    <header><span>Client Forms</span><h1>Your Forms</h1><p>Complete required onboarding and Project intake Forms. Every response stays linked to the version you received.</p></header>
    <section><div className={styles.clientSectionTitle}><div><ClipboardList aria-hidden="true" /><h2>Required Forms</h2></div><span>{required.length}</span></div>{required.length === 0 ? <div className={styles.clientEmpty}><CheckCircle2 aria-hidden="true" /><strong>You’re all caught up.</strong><span>No Forms currently require a response.</span></div> : <div className={styles.clientAssignmentList}>{required.map((assignment) => <Link href={`/account/forms/${assignment.assignment_id}`} key={assignment.assignment_id}><div className={styles.assignmentIcon}><ClipboardList aria-hidden="true" /></div><div><strong>{assignment.title}</strong><span>{titleCaseState(assignment.form_type)} Form{assignment.order_title ? ` · ${assignment.order_title}` : ""}</span></div><dl><div><dt>Due</dt><dd>{formatDate(assignment.due_at)}</dd></div><div><dt>Required</dt><dd>{assignment.required ? "Yes" : "Optional"}</dd></div></dl><span className={styles.status} data-state="assigned">To complete</span><ArrowRight aria-hidden="true" /></Link>)}</div>}</section>
    <section><div className={styles.clientSectionTitle}><div><Clock3 aria-hidden="true" /><h2>Completed Forms</h2></div><span>{completed.length}</span></div>{completed.length === 0 ? <p className={styles.sectionEmpty}>Your completed Forms will appear here.</p> : <div className={styles.clientAssignmentList}>{completed.map((assignment) => <Link href={`/account/forms/${assignment.assignment_id}`} key={assignment.assignment_id}><div className={styles.assignmentIcon}><CheckCircle2 aria-hidden="true" /></div><div><strong>{assignment.title}</strong><span>Version {assignment.version_number}{assignment.order_title ? ` · ${assignment.order_title}` : ""}</span></div><dl><div><dt>Completed</dt><dd>{formatDate(assignment.completed_at)}</dd></div></dl><span className={styles.status} data-state="submitted">Completed</span><ArrowRight aria-hidden="true" /></Link>)}</div>}</section>
  </div>;
}
