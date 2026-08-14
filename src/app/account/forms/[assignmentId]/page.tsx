import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormRenderer } from "../../../../components/forms/form-renderer";
import { getClientContext } from "../../../../lib/supabase/next-server";
import styles from "../../../../components/forms/forms.module.css";

export default async function AssignedFormPage({ params }: PageProps<"/account/forms/[assignmentId]">) {
  const [{ assignmentId }, context] = await Promise.all([params, getClientContext()]);
  try {
    const detail = await context.services.forms.getAssignedForm(assignmentId);
    return <div className={styles.clientFormPage}><Link href="/account/forms" className={styles.backLink}><ArrowLeft aria-hidden="true" />Your Forms</Link><section className={styles.clientAssignmentContext}><div><span>{detail.assignment.form_type} Form</span><strong>{detail.assignment.order_title ?? detail.assignment.company_name}</strong></div><dl><div><dt>Due</dt><dd>{detail.assignment.due_at ? new Date(detail.assignment.due_at).toLocaleDateString() : "No due date"}</dd></div><div><dt>Version</dt><dd>{detail.assignment.version_number}</dd></div></dl></section><FormRenderer schema={detail.schema} mode="assigned" assignmentId={assignmentId} completed={detail.assignment.status === "submitted"} /></div>;
  } catch {
    notFound();
  }
}
