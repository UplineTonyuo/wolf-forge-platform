import type { Metadata } from "next";
import { ClientOrderStart } from "../../../../components/account/projects/client-order-start";
import type { ClientOrderStartState } from "../../../../domain/orders/client-start";
import { notFound, redirect } from "next/navigation";
import { ClientProjectDetail } from "../../../../components/account/projects/client-projects";
import type { ClientProjectView } from "../../../../domain/orders/client-projections";
import type { OrderConversationPage } from "../../../../domain/orders/conversation-page";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { getClientContext } from "../../../../lib/supabase/next-server";
import { readClientAssignments } from "../../../../lib/supabase/client-portal-data";
import Link from "next/link";
import { FormsVisibilityBoundary } from "../../../../components/forms/forms-visibility-boundary";
import { loadFormsVisibility } from "../../../actions/forms-visibility";

export const metadata: Metadata = { title: "Order" };

export default async function ClientProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { services, user } = await getClientContext();

  let project: ClientProjectView | null = null;
  let conversation: OrderConversationPage | null = null;
  let denied = false;
  let missing = false;
  let startState: ClientOrderStartState | null = null;
  let startError = false;

  try {
    await services.permissions.requireModuleAccess("portal_projects");
    const [loadedProject, start] = await Promise.all([
      services.projects.getClientProject(projectId),
      services.projects.getClientStartState(projectId).then(state => ({ state, error: false })).catch(() => ({ state: null, error: true })),
    ]);
    project = loadedProject;
    startState = start.state;
    startError = start.error;
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

  // Include legacy and later required forms without backfilling a start gate.
  let legacyIntake: Awaited<ReturnType<typeof readClientAssignments>> = null;
  let legacyIntakeError = false;
  let formsSignature: string | null = null;
  if (!startError && user.modules.portal_forms === true) {
    try {
      const visibility = await loadFormsVisibility("client");
      if (visibility.ok) {
        formsSignature = visibility.signature;
        const assignments = await readClientAssignments();
        if (assignments === null) legacyIntakeError = true;
        else legacyIntake = assignments.filter((form) => form.order_id === projectId && form.form_type === "intake" && form.required && form.status === "assigned"
          && (startState?.started || !startState?.forms.some((frozen) => frozen.id === form.assignment_id)));
      } else { legacyIntakeError = true; }
    } catch { legacyIntakeError = true; }
  }
  const legacyControl = legacyIntake?.length && formsSignature !== null ? <FormsVisibilityBoundary scope="client" signature={formsSignature}><section id="required-order-forms" className="portal-section">
    <h2>Complete your order information</h2>
    <p>Complete the required service forms for this order.</p>
    <ul>{legacyIntake.map((form) => <li key={form.assignment_id}>{form.work_enabled !== false ? <Link href={`/account/onboarding/${form.assignment_id}`}>Complete intake form: {form.order_title ?? form.title}</Link> : <span>Form collection is paused. Contact the team.</span>}</li>)}</ul>
  </section></FormsVisibilityBoundary> : legacyIntakeError ? <p role="alert">Required forms could not be loaded. Reload to try again.</p> : null;

  let chatAccess: "locked" | "unlocked" | "unavailable" = "unavailable";
  if (!startError && !legacyIntakeError) {
    try {
      const eligible = await services.projects.getClientChatEligibility(projectId);
      chatAccess = eligible && !legacyIntake?.length ? "unlocked" : "locked";
      if (chatAccess === "unlocked") conversation = await services.tickets.getOrderPage(projectId);
    } catch { chatAccess = "unavailable"; conversation = null; }
  }

  return <ClientProjectDetail project={project} conversation={conversation} viewerId={user.id}
    chatAccess={chatAccess}
    startControl={startError ? <p role="alert">Order start status could not be loaded. Reload before starting this order.</p> : <>{startState ? <ClientOrderStart initial={startState} /> : null}{legacyControl}</>} />;
}
