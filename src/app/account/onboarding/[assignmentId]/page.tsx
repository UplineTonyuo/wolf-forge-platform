import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormRenderer } from "../../../../components/forms/form-renderer";
import { SubmissionDetail } from "../../../../components/forms/submission-detail";
import { formatDate } from "../../../../lib/format";
import { getClientContext } from "../../../../lib/supabase/next-server";
import styles from "../../../../components/forms/forms.module.css";
import { assignedFormTitle } from "../../../../domain/forms/assignment-title";

export const metadata: Metadata = { title: "Order form" };

/**
 * One assigned onboarding or intake Form.
 *
 * app_get_assigned_form_schema resolves the assignment from auth.uid(), so an
 * assignment id belonging to another company is rejected by the database rather
 * than filtered here — it arrives as a thrown error and becomes a 404, which
 * never confirms whether the assignment exists.
 */
export default async function AssignedFormPage({
  params,
  searchParams,
}: PageProps<"/account/onboarding/[assignmentId]">) {
  const [{ assignmentId }, query, context] = await Promise.all([params, searchParams, getClientContext()]);

  try {
    const [history, workEnabled] = await Promise.all([
      context.services.forms.getAssignmentHistory(assignmentId),
      context.services.forms.workEnabled(),
    ]);
    if (history.status === "completed" || !workEnabled) {
      const receipt = history.latest_submission_id
        ? await context.services.forms.getSubmission(history.latest_submission_id)
        : null;
      return <div className={styles.clientFormPage}>
        <Link href="/account/projects#forms" className={styles.backLink}><ArrowLeft aria-hidden="true" />All forms</Link>
        <h1>{assignedFormTitle(history)}</h1>
        {!workEnabled ? <p>Form collection is paused. Your request and submitted responses are retained.</p> : null}
        {receipt ? <SubmissionDetail detail={receipt} canCorrect={false} automaticPdf={history.status === "completed" && typeof query.submitted === "string" && query.submitted === history.latest_submission_id && query.submitted === receipt.submission.id} /> : <p>No response has been submitted. This request remains outstanding.</p>}
        {history.order_id && context.user.modules.portal_projects === true ? <Link href={`/account/projects/${history.order_id}`}>View your order →</Link> : null}
      </div>;
    }
    const detail = await context.services.forms.getAssignedForm(assignmentId);
    const { assignment } = detail;
    // 'completed' is the value app_submit_form writes; see the
    // form_assignments_status_valid check constraint.
    const completed = assignment.status === "completed";

    return (
      <div className={styles.clientFormPage}>
        <Link href="/account/projects#forms" className={styles.backLink}>
          <ArrowLeft aria-hidden="true" />
          All forms
        </Link>

        <section className={styles.clientAssignmentContext}>
          <div>
            <span>{assignment.form_type === "intake" ? "Order information" : "Account setup"}</span>
            <strong>{assignedFormTitle(assignment)}</strong>
          </div>
          <dl>
            {assignment.order_title ? (
              <div>
                <dt>Order</dt>
                <dd>{assignment.order_title}</dd>
              </div>
            ) : null}
            <div>
              <dt>{completed ? "Completed" : "Due"}</dt>
              <dd>
                {completed
                  ? formatDate(assignment.completed_at)
                  : assignment.due_at
                    ? formatDate(assignment.due_at)
                    : "No due date"}
              </dd>
            </div>
            <div>
              <dt>Required</dt>
              <dd>{assignment.required ? "Yes" : "Optional"}</dd>
            </div>
          </dl>
        </section>

        <FormRenderer
          schema={detail.schema}
          mode="assigned"
          assignmentId={assignmentId}
          completed={completed}
          displayTitle={assignedFormTitle(assignment)}
        />
      </div>
    );
  } catch {
    notFound();
  }
}
