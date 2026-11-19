import { notFound, redirect } from "next/navigation";
import { canManageProcess, sections } from "../../../../../domain/process/settings";
import { ProcessEditor } from "../../../../../components/settings/process-editor";
import { readProcess } from "../../../../../lib/settings/process";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export default async function ProcessPage({params}:{params:Promise<{section:string}>}) {
  const requested = (await params).section;
  const section = sections.find(value=>value === requested);
  const context = await getInternalContext();
  await context.services.permissions.requireModuleAccess("settings");
  if (!canManageProcess(context.user.role)) redirect("/settings/general");
  if (!section) notFound();
  const snapshot = await readProcess(section);
  return <ProcessEditor key={section} section={section} {...snapshot}/>;
}

