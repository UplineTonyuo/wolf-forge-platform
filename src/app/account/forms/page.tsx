import type { Metadata } from "next";
import { ClientForms } from "../../../components/forms/client-forms";
import { getClientContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "My Forms" };

export default async function AccountFormsPage() {
  const context = await getClientContext();
  const assignments = await context.services.forms.listAssignments();
  return <ClientForms assignments={assignments} />;
}
