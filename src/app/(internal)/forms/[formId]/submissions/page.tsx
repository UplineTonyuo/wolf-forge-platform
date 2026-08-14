import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormSubmissions } from "../../../../../components/forms/form-submissions";
import { PageFrame } from "../../../../../components/ui/page-frame";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export default async function FormSubmissionsPage({ params }: PageProps<"/forms/[formId]/submissions">) {
  const [{ formId }, context] = await Promise.all([params, getInternalContext()]);
  try {
    const [detail, submissions] = await Promise.all([context.services.forms.get(formId), context.services.forms.listSubmissions(formId)]);
    return <PageFrame title={`${detail.form.name} submissions`} description="Responses are shown against the immutable Form version used at submission time." action={<Link className="button-secondary" href={`/forms/${formId}`}><ArrowLeft aria-hidden="true" />Builder</Link>}><FormSubmissions submissions={submissions} /></PageFrame>;
  } catch {
    notFound();
  }
}
