import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClientProjectsList } from "../../../components/account/projects/client-projects";
import type { ClientProjectView } from "../../../domain/orders/client-projections";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { readClientProjects, readClientAssignments } from "../../../lib/supabase/client-portal-data";
import { getClientContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "My Projects" };

export default async function ClientProjectsPage() {
  const { services } = await getClientContext();

  let projects: ClientProjectView[] = [];
  let denied = false;
  let loadError: string | null = null;
  let intakeError: string | null = null;
  const intakeLinks: Record<string, string> = {};

  try {
    /*
     * The module boundary is the authority, not the rail. A typed URL reaches
     * this call and is rejected exactly like a hidden nav item. The Project RPC
     * independently derives company scope and exposes only the portal DTO.
     */
    await services.permissions.requireModuleAccess("portal_projects");
    // Memoized for the request, so the rail's in-progress count and this page
    // share one read rather than querying twice.
    projects = (await readClientProjects()) ?? [];
    // Intake links are optional; a Forms denial must not hide authorized Projects.
    let assignments: Awaited<ReturnType<typeof readClientAssignments>> = null;
    try { assignments = await readClientAssignments(); }
    catch { intakeError = "Intake status could not be loaded. Open the project or reload to check its required forms."; }
    for (const form of assignments ?? []) {
      if (form.order_id && form.form_type === "intake" && form.required && form.status === "assigned" && form.work_enabled !== false && !intakeLinks[form.order_id]) {
        intakeLinks[form.order_id] = `/account/onboarding/${form.assignment_id}`;
      }
    }
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "PERMISSION_DENIED") denied = true;
    else loadError = safe.message || "Projects could not be loaded.";
  }

  // redirect() throws its own control-flow error, so it stays outside the catch.
  if (denied) redirect("/account");

  if (loadError) {
    return (
      <div className="portal-page">
        <header className="portal-page-head">
          <h1>Projects</h1>
        </header>
        <p className="portal-empty">{loadError}</p>
      </div>
    );
  }

  return <ClientProjectsList projects={projects} intakeLinks={intakeLinks} intakeError={intakeError} />;
}
