import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormAssignments, type AssignmentOption } from "../../../../../components/forms/form-assignments";
import { PageFrame } from "../../../../../components/ui/page-frame";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export default async function AssignFormPage({ params }: PageProps<"/forms/[formId]/assign">) {
  const [{ formId }, context] = await Promise.all([params, getInternalContext()]);
  if (!context.user.forms.assign || !await context.services.forms.workEnabled()) {
    return <PageFrame title="Form assignment unavailable" description="New assignments require current collection access."><p>Outstanding assignments are retained.</p></PageFrame>;
  }
  try {
    const [detail, allAssignments] = await Promise.all([context.services.forms.get(formId), context.services.forms.listAssignments()]);
    if (detail.form.form_type !== "intake" && detail.form.form_type !== "onboarding") notFound();
    let options: AssignmentOption[];
    if (detail.form.form_type === "intake") {
      const page = await context.services.orders.listProjects();
      const published = detail.form.published_version_id ? await context.services.forms.getVersion(detail.form.id, detail.form.published_version_id) : null;
      const serviceIds = new Set((published?.service_links ?? []).map((link) => link.service_id));
      options = page.rows.filter((row) => serviceIds.has(row.serviceId)).map((row) => ({ id: row.id, label: `#${row.orderNumber} ${row.title}`, detail: `${row.companyName ?? "Client"} · ${row.serviceName ?? "Service"}` }));
    } else {
      const candidates = await context.services.forms.listOnboardingCandidates();
      options = candidates.map((candidate) => ({ id: candidate.profile_id, label: candidate.display_name ?? "Client", detail: candidate.company_name }));
    }
    return <PageFrame title={`Assign ${detail.form.name}`} description={detail.form.form_type === "intake" ? "Assign the published Intake Form to an eligible Project." : "Assign the published Onboarding Form to a client company."} action={<Link className="button-secondary" href={`/forms/${formId}`}><ArrowLeft aria-hidden="true" />Builder</Link>}><FormAssignments formId={formId} formType={detail.form.form_type} assignments={allAssignments.filter((assignment) => assignment.form_id === formId)} options={options} /></PageFrame>;
  } catch {
    notFound();
  }
}
