import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClientProjectsList } from "../../../components/account/projects/client-projects";
import { ClientOnboardingView } from "../../../components/account/onboarding/client-onboarding";
import { FormsVisibilityBoundary } from "../../../components/forms/forms-visibility-boundary";
import { loadFormsVisibility } from "../../actions/forms-visibility";
import { composeClientOnboarding } from "../../../domain/client-portal/onboarding";
import type { ClientProjectView } from "../../../domain/orders/client-projections";
import type { OrderResponseState } from "../../../domain/orders/projections";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { readClientProjects, readClientAssignments } from "../../../lib/supabase/client-portal-data";
import { getClientContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "My Orders" };

export default async function ClientProjectsPage() {
  const { user, services } = await getClientContext();
  const intakeLinks: Record<string, string> = {};

  // One landing page, two independent grants. Forms-only accounts must never
  // query orders, and an Orders grant must never grant access to forms.
  async function loadProjects() {
    let showProjects = false;
    let projects: ClientProjectView[] = [];
    let responseStates: OrderResponseState[] = [];
    let replyError: string | null = null;
    let loadError: string | null = null;
    if (user.modules.portal_projects === true) {
      try {
        await services.permissions.requireModuleAccess("portal_projects");
        showProjects = true;
        projects = (await readClientProjects()) ?? [];
        if (projects.length > 0) {
          try {
            responseStates = await services.projects.listClientResponseStates(projects.map((project) => project.id));
            const states = new Map(responseStates.map((state) => [state.order_id, state.unanswered]));
            if (projects.some((project) => states.get(project.id) == null)) replyError = "Some reply statuses are unavailable. Reload to try again.";
          } catch { replyError = "Reply status could not be loaded. Reload to try again."; }
        }
      } catch (error) {
        const safe = toClientSafeError(error);
        if (safe.code === "PERMISSION_DENIED") showProjects = false;
        else loadError = safe.message || "Orders could not be loaded.";
      }
    }
    return { showProjects, projects, responseStates, replyError, loadError };
  }
  async function loadForms() {
    let showForms = false;
    let assignments: Awaited<ReturnType<typeof readClientAssignments>> = null;
    let intakeError: string | null = null;
    let formsSignature: string | null = null;
    if (user.modules.portal_forms === true) {
      try {
        await services.permissions.requireModuleAccess("portal_forms");
        showForms = true;
        const visibility = await loadFormsVisibility("client");
        if (visibility.ok) {
          formsSignature = visibility.signature;
          assignments = await readClientAssignments();
        } else {
          intakeError = "Form information is unavailable under your current access.";
        }
      } catch (error) {
        const safe = toClientSafeError(error);
        if (safe.code === "PERMISSION_DENIED") showForms = false;
        intakeError = "Intake status could not be loaded. Open the order or reload to check its required forms.";
      }
    }
    return { showForms, assignments, intakeError, formsSignature };
  }
  const [projectsState, formsState] = await Promise.all([loadProjects(), loadForms()]);
  const { showProjects, projects, responseStates, replyError, loadError } = projectsState;
  const { showForms, assignments, intakeError, formsSignature } = formsState;
  if (!showProjects && !showForms) redirect("/account");
  for (const form of assignments ?? []) {
    if (form.order_id && form.form_type === "intake" && form.required && form.status === "assigned" && form.work_enabled !== false && !intakeLinks[form.order_id]) {
      intakeLinks[form.order_id] = `/account/onboarding/${form.assignment_id}`;
    }
  }

  return <ClientProjectsList
    projects={projects}
    responseStates={responseStates}
    replyError={replyError}
    showProjects={showProjects}
    intakeLinks={intakeLinks}
    intakeError={intakeError}
    loadError={loadError}
    formsContent={showForms ? assignments && formsSignature !== null ? <FormsVisibilityBoundary scope="client" signature={formsSignature}><ClientOnboardingView onboarding={composeClientOnboarding(assignments)} embedded /></FormsVisibilityBoundary> : <p role="alert">Forms could not be loaded. Reload to try again.</p> : null}
  />;
}
