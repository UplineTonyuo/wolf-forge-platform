import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ClientProjectDetail } from "../../../../components/account/projects/client-projects";
import type { ClientProjectView } from "../../../../domain/orders/client-projections";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { getClientContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Project" };

export default async function ClientProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { services } = await getClientContext();

  let project: ClientProjectView | null = null;
  let denied = false;
  let missing = false;

  try {
    await services.permissions.requireModuleAccess("portal_projects");
    project = await services.projects.getClientProject(projectId);
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "PERMISSION_DENIED") denied = true;
    // A project outside the company is filtered by RLS, so it arrives here as
    // "not found" rather than "forbidden". That is the intended answer: the
    // portal never confirms that another company's project exists.
    else missing = true;
  }

  if (denied) redirect("/account");
  if (missing || !project) notFound();

  return <ClientProjectDetail project={project} />;
}
