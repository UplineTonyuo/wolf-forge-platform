import type { Metadata } from "next";
import { FormsList } from "../../../components/forms/forms-list";
import { PageFrame } from "../../../components/ui/page-frame";
import { getInternalContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Forms" };

export default async function FormsPage() {
  const context = await getInternalContext();
  const forms = await context.services.forms.list();
  return <PageFrame title="Forms" description="Build, publish, assign, and review reusable client Forms."><FormsList forms={forms} capabilities={context.user.forms} /></PageFrame>;
}
