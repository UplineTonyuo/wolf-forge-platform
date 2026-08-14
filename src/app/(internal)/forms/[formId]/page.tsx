import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormBuilder } from "../../../../components/forms/form-builder";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Form Builder" };

export default async function FormBuilderPage({ params }: PageProps<"/forms/[formId]">) {
  const [{ formId }, context] = await Promise.all([params, getInternalContext()]);
  try {
    const [detail, services] = await Promise.all([context.services.forms.get(formId), context.services.catalog.listActive()]);
    return <FormBuilder detail={detail} capabilities={context.user.forms} services={services} />;
  } catch {
    notFound();
  }
}
