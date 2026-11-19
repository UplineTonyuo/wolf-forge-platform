import { ArrowLeft } from "lucide-react";
import { RouteTransitionLink as Link } from "../shell/route-transition";
import type { TicketCapabilities, TicketDetail, TicketSummary } from "../../domain/tickets/schema";
import type { ServiceAssigneeOption } from "../../repositories/service-repository";
import { TicketWorkspaceList } from "./ticket-workspace-list";
import { TicketInboxAction } from "./ticket-inbox-action";
import { TicketInspector } from "./ticket-inspector";
import styles from "./tickets.module.css";

/**
 * `/tickets/[ticketId]` -- the operational surface: which client, how long it
 * has been open, who owns it, where it is in its lifecycle, and the one
 * control that decides whether its conversation also appears in the Inbox.
 *
 * Deliberately carries NO transcript and NO reply composer. A Ticket's
 * conversation has exactly one home: Inbox -> Tickets, which mounts
 * TicketAdminConversation. A second renderer here was tried and removed -- it
 * made the management page and the messaging surface the same page, and left
 * two live pollers competing for one Ticket in one tab.
 *
 * The controls themselves are not reimplemented: TicketInspector is the same
 * composition the Inbox drawer's Details pane renders, so Details, Operations
 * and Internal notes cannot drift between the two surfaces. Because the
 * composer is absent, no client-visible/internal-note boundary moved: internal
 * notes are read here through the same capability-gated modal, and the
 * transcript they are hidden from is elsewhere entirely.
 */
export function TicketWorkspace({
  ticketId,
  detail,
  summaries,
  assignees,
  capabilities,
}: {
  ticketId: string;
  detail: TicketDetail;
  summaries: TicketSummary[];
  assignees: ServiceAssigneeOption[];
  capabilities: TicketCapabilities;
}) {
  const ticket = detail.ticket;

  return (
    <div className={styles.ticketWorkspace}>
      <TicketWorkspaceList key={ticketId} summaries={summaries} ticketId={ticketId} />

      <div className={styles.ticketWorkspaceManagement}>
        {/* Only shown where the list column above is hidden, i.e. below the
            two-column breakpoint. */}
        <Link href="/tickets" className={styles.workspaceBackLink}>
          <ArrowLeft aria-hidden="true" />
          All Tickets
        </Link>

        <TicketInspector
          detail={detail}
          assignees={assignees}
          capabilities={capabilities}
          footer={
            <TicketInboxAction
              ticketId={ticket.id}
              inboxAddedAt={ticket.inbox_added_at ?? null}
              personalInboxAddedAt={ticket.personal_inbox_added_at ?? null}
              canManage={capabilities.edit}
            />
          }
        />
      </div>
    </div>
  );
}
