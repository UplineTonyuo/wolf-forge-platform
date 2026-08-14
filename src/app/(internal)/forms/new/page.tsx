import type { Metadata } from "next";
import { CreateForm } from "../../../../components/forms/create-form";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "New Form" };

export default async function NewFormPage() {
  const context = await getInternalContext();
  const services = await context.services.catalog.listActive();
  return <CreateForm services={services} />;
}
