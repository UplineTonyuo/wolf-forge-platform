import type { ReactNode } from "react";
import { CalendarDays, FileInput, History } from "lucide-react";
import Link from "next/link";
import type { TicketCapabilities, TicketDetail, TicketDetailMessage } from "../../domain/tickets/schema";
import type { ServiceAssigneeOption } from "../../repositories/service-repository";
import { formatDateTime } from "../../lib/format";
import { InternalNotesModal } from "./internal-notes-modal";
import { TicketAdminControls } from "./ticket-admin-controls";
import styles from "./tickets.module.css";

/**
 * The single cohesive Ticket inspector -- Ticket details, Operations,
 * Internal notes -- shared between the `/tickets/[ticketId]` workspace and
 * the Inbox drawer's inspector pane. One composition, so the two surfaces
 * cannot visually drift apart the way separate copies of this would.
 */
export function TicketInspector({
  detail,
  assignees,
  capabilities,
  onTicketChanged,
  footer,
}: {
  detail: TicketDetail;
  assignees: ServiceAssigneeOption[];
  capabilities: TicketCapabilities;
  onTicketChanged?: () => void;
  /**
   * Optional last section. The management page slots its one Inbox control
   * in here so it inherits the same section rhythm as Details and Operations
   * instead of approximating the padding from outside. The Inbox drawer's own
   * inspector passes nothing and is unaffected.
   */
  footer?: ReactNode;
}) {
  const ticket = detail.ticket;
  const internalNotes: TicketDetailMessage[] = detail.messages.filter(
    (message) => message.message_kind === "internal_note",
  );

  return (
    <div className={styles.inspectorSections}>
      <section>
        <h2>Ticket details</h2>
        <dl className={styles.ticketMeta}>
          <div>
            <dt>Client / company</dt>
            <dd>{detail.company_name ?? detail.client_name ?? ticket.requester_name ?? "Contact Form guest"}</dd>
          </div>
          {detail.client_name && detail.company_name ? (
            <div>
              <dt>Contact</dt>
              <dd>{detail.client_name}</dd>
            </div>
          ) : null}
          <div>
            <dt>Created</dt>
            <dd className={styles.ticketDateValue}>
              <CalendarDays aria-hidden="true" />
              <span>{formatDateTime(ticket.created_at)}</span>
            </dd>
          </div>
          <div>
            <dt>Last activity</dt>
            <dd className={styles.ticketDateValue}>
              <History aria-hidden="true" />
              <span>{formatDateTime(ticket.updated_at)}</span>
            </dd>
          </div>
          {ticket.resolved_at ? (
            <div>
              <dt>Resolved</dt>
              <dd>{formatDateTime(ticket.resolved_at)}</dd>
            </div>
          ) : null}
          {ticket.closed_at ? (
            <div>
              <dt>Closed</dt>
              <dd>{formatDateTime(ticket.closed_at)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {ticket.source_form_submission_id ? (
        <section>
          <div className={styles.sourceIndicator}>
            <FileInput aria-hidden="true" />
            <div>
              <strong>Contact Form source</strong>
              This Ticket was created from a submitted Contact Form.{" "}
              <Link href={`/forms/submissions/${ticket.source_form_submission_id}`}>View exact submission</Link>
            </div>
          </div>
        </section>
      ) : null}

      <section>
        <h2>Operations</h2>
        <TicketAdminControls
          ticketId={ticket.id}
          status={ticket.status}
          priority={ticket.priority}
          assigneeId={ticket.assigned_to_profile_id ?? null}
          assignees={assignees}
          capabilities={capabilities}
          onChanged={onTicketChanged}
        />
      </section>

      {capabilities.internalNotes ? (
        <section>
          <h2>Internal notes</h2>
          <InternalNotesModal
            target={{ kind: "ticket", ticketId: ticket.id }}
            notes={internalNotes}
            disabled={Boolean(ticket.archived_at)}
          />
        </section>
      ) : null}

      {footer ? <section>{footer}</section> : null}
    </div>
  );
}
