import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormRenderer } from "../../../../components/forms/form-renderer";
import { formatDate } from "../../../../lib/format";
import { getClientContext } from "../../../../lib/supabase/next-server";
import styles from "../../../../components/forms/forms.module.css";

export const metadata: Metadata = { title: "Onboarding item" };

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
}: PageProps<"/account/onboarding/[assignmentId]">) {
  const [{ assignmentId }, context] = await Promise.all([params, getClientContext()]);

  try {
    const detail = await context.services.forms.getAssignedForm(assignmentId);
    const { assignment } = detail;
    // 'completed' is the value app_submit_form writes; see the
    // form_assignments_status_valid check constraint.
    const completed = assignment.status === "completed";

    return (
      <div className={styles.clientFormPage}>
        <Link href="/account/onboarding" className={styles.backLink}>
          <ArrowLeft aria-hidden="true" />
          All onboarding
        </Link>

        <section className={styles.clientAssignmentContext}>
          <div>
            <span>{assignment.order_title ? "Project information" : "Account setup"}</span>
            <strong>{assignment.title}</strong>
          </div>
          <dl>
            {assignment.order_title ? (
              <div>
                <dt>Project</dt>
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
        />
      </div>
    );
  } catch {
    notFound();
  }
}
