import type { Metadata } from "next";
import { ClientOrderStart } from "../../../../components/account/projects/client-order-start";
import type { ClientOrderStartState } from "../../../../domain/orders/client-start";
import { notFound, redirect } from "next/navigation";
import { ClientProjectDetail } from "../../../../components/account/projects/client-projects";
import type { ClientProjectView } from "../../../../domain/orders/client-projections";
import type { TicketDetail } from "../../../../domain/tickets/schema";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { getClientContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Project" };

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

  return <ClientProjectDetail project={project} conversation={conversation} viewerId={user.id}
    startControl={startError ? <p role="alert">Order start status could not be loaded. Reload before starting this order.</p> : <ClientOrderStart initial={startState} />} />;
}
