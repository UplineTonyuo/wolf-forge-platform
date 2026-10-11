import type { Metadata } from "next";
import { FormsList } from "../../../components/forms/forms-list";
import { FormSubmissions } from "../../../components/forms/form-submissions";
import { PageFrame } from "../../../components/ui/page-frame";
import { getInternalContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Forms" };

export default async function FormsPage() {
  const context = await getInternalContext();
  if (!context.user.forms.view && context.user.forms.submissionsView) {
    const submissions = await context.services.forms.listSubmissions();
    return <PageFrame title="Form responses" description="Retained responses under your current history access."><FormSubmissions submissions={submissions} /></PageFrame>;
  }
  const forms = await context.services.forms.list();
  return <PageFrame title="Forms" description="Build, publish, assign, and review reusable client Forms."><FormsList forms={forms} capabilities={context.user.forms} /></PageFrame>;
}
