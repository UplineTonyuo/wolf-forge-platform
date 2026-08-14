import Link from "next/link";
import type { FormSubmissionSummary } from "../../domain/forms/schema";
import { formatDate } from "../../lib/format";
import { titleCaseState } from "../../lib/forms/presentation";
import styles from "./forms.module.css";

export function FormSubmissions({ submissions }: { submissions: FormSubmissionSummary[] }) {
  if (submissions.length === 0) return <section className={styles.empty}><h2>No submissions yet.</h2><p>Completed responses will appear here against their exact published version.</p></section>;
  return <div className={styles.tableWrap}><table className={styles.submissionTable}><thead><tr><th>Submitted</th><th>Version</th><th>Assignment</th><th>Project</th><th>Revision</th><th>Status</th></tr></thead><tbody>{submissions.map((submission) => <tr key={submission.id}><td><Link href={`/forms/submissions/${submission.id}`} className={styles.rowLink}><strong>{formatDate(submission.submitted_at)}</strong><small>View exact answers</small></Link></td><td>Version linked</td><td>{submission.form_assignment_id ? "Assigned Form" : "Direct"}</td><td>{submission.order_id ? "Linked Project" : "—"}</td><td>{submission.revision_number === 1 ? "Original" : `Correction ${submission.revision_number - 1}`}</td><td><span className={styles.status} data-state={submission.status}>{titleCaseState(submission.status)}</span></td></tr>)}</tbody></table></div>;
}
