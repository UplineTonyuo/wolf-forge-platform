import type { FormSubmissionDetail } from "../../domain/forms/schema";
import type { FormService } from "../../services/form-service";
import { OrderResponse } from "./order-response";
import styles from "./order-responses.module.css";
import { visibleSubmittedFields } from "../../lib/forms/submitted-fields";

export async function OrderSubmittedForms({ forms, orderId, companyId }: { forms: FormService; orderId: string; companyId: string }) {
  let formGroups: Array<{ formId: string; title: string; latest: FormSubmissionDetail; history: FormSubmissionDetail[] }>;
  try {
    const summaries = await forms.listSubmissions(undefined, orderId);
    const scoped = summaries.filter((row) => row.order_id === orderId && row.company_id === companyId);

    const details = await Promise.all(scoped.map((row) => forms.getSubmission(row.id)));
    const groups = new Map<string, FormSubmissionDetail[]>();
    for (const detail of details) {
      const summary = scoped.find((row) => row.id === detail.submission.id);
      if (!summary || detail.submission.order_id !== orderId || detail.submission.company_id !== companyId || detail.submission.form_id !== summary.form_id || detail.submission.form_version_id !== summary.form_version_id) {
        throw new Error("Submission scope changed");
      }
      const group = groups.get(detail.submission.form_id) ?? [];
      group.push({ ...detail, values: visibleSubmittedFields(detail.values) });
      groups.set(detail.submission.form_id, group);
    }

    formGroups = await Promise.all([...groups.entries()].map(async ([formId, responses], index) => {
      responses.sort((a, b) => Date.parse(b.submission.submitted_at) - Date.parse(a.submission.submitted_at) || b.submission.revision_number - a.submission.revision_number);
      const latest = responses[0]!;
      const history = responses.slice(1);
      let title = `Submitted form ${index + 1}`;
      if (latest.submission.form_assignment_id) {
        try {
          const assignment = await forms.getAssignmentHistory(latest.submission.form_assignment_id);
          if (assignment.order_id === orderId && assignment.company_id === companyId && assignment.form_id === formId) title = assignment.title;
        } catch { /* A submission may remain readable without assignment metadata. */ }
      }
      return { formId, title, latest, history };
    }));
  } catch {
    return <p role="alert">Form responses are unavailable. Reload to check your current access and try again.</p>;
  }
  if (!formGroups.length) return <p>No form has been submitted for this Order yet.</p>;
  return formGroups.map(({ formId, title, latest, history }) => <section key={formId} className={styles.group} aria-label={title}>
    <h3>{title}</h3>
    <OrderResponse key={latest.submission.id} detail={latest} />
    {history.length ? <details className={styles.history}>
      <summary>Earlier responses ({history.length})</summary>
      {history.map((detail) => <OrderResponse key={detail.submission.id} detail={detail} latest={false} />)}
    </details> : null}
  </section>);
}
