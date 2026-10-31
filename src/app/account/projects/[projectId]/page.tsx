import type { Metadata } from "next";
import { ClientOrderStart } from "../../../../components/account/projects/client-order-start";
import type { ClientOrderStartState } from "../../../../domain/orders/client-start";
import { notFound, redirect } from "next/navigation";
import { ClientProjectDetail } from "../../../../components/account/projects/client-projects";
import type { ClientProjectView } from "../../../../domain/orders/client-projections";
import type { TicketDetail } from "../../../../domain/tickets/schema";
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
  let conversation: TicketDetail | null = null;
  let denied = false;
  let missing = false;
  let startState: ClientOrderStartState | null = null;
  let startError = false;

  try {
    await services.permissions.requireModuleAccess("portal_projects");
    [project, conversation] = await Promise.all([
      services.projects.getClientProject(projectId),
      services.tickets.getForOrder(projectId),
      services.projects.getClientStartState(projectId).then((state) => { startState = state; }).catch(() => { startError = true; }),
    ]);
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

  // Older purchases may have assigned intake without a frozen start gate.
  // Keep those real requests reachable without creating or backfilling a gate.
  let legacyIntake: Awaited<ReturnType<typeof readClientAssignments>> = null;
  let legacyIntakeError = false;
  let formsSignature: string | null = null;
  if (!startError && !startState && user.modules.portal_forms === true) {
    try {
      const visibility = await loadFormsVisibility("client");
      if (visibility.ok) {
        formsSignature = visibility.signature;
        legacyIntake = (await readClientAssignments())?.filter((form) => form.order_id === projectId && form.form_type === "intake" && form.required && form.status === "assigned") ?? [];
      } else { legacyIntakeError = true; }
    } catch { legacyIntakeError = true; }
  }
  const legacyControl = legacyIntake?.length && formsSignature !== null ? <FormsVisibilityBoundary scope="client" signature={formsSignature}><section id="start-order" className="portal-section">
    <h2>Complete your order information</h2>
    <p>Complete the required service forms for this order.</p>
    <ul>{legacyIntake.map((form) => <li key={form.assignment_id}>{form.work_enabled !== false ? <Link href={`/account/onboarding/${form.assignment_id}`}>Complete intake form: {form.order_title ?? form.title}</Link> : <span>Form collection is paused. Contact the team.</span>}</li>)}</ul>
  </section></FormsVisibilityBoundary> : legacyIntakeError ? <p role="alert">Required forms could not be loaded. Reload to try again.</p> : null;

  return <ClientProjectDetail project={project} conversation={conversation} viewerId={user.id}
    startControl={startError ? <p role="alert">Order start status could not be loaded. Reload before starting this order.</p> : startState ? <ClientOrderStart initial={startState} /> : legacyControl} />;
}
