import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmissionDetail } from "../../../../../components/forms/submission-detail";
import { PageFrame } from "../../../../../components/ui/page-frame";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export default async function SubmissionPage({ params }: PageProps<"/forms/submissions/[submissionId]">) {
  const [{ submissionId }, context] = await Promise.all([params, getInternalContext()]);
  try {
    const detail = await context.services.forms.getSubmission(submissionId);
    return <PageFrame title="Form submission" description="Permanent response history with append-only corrections." action={<Link className="button-secondary" href={`/forms/${detail.submission.form_id}/submissions`}><ArrowLeft aria-hidden="true" />Submissions</Link>}><SubmissionDetail detail={detail} canCorrect={context.user.forms.submissionsManage} /></PageFrame>;
  } catch {
    notFound();
  }
}
