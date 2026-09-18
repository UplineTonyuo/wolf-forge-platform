import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TicketWorkspace } from "../../../../components/tickets/ticket-workspace";
import styles from "../../../../components/tickets/tickets.module.css";
import { PageFrame } from "../../../../components/ui/page-frame";
import { toClientSafeError } from "../../../../lib/errors/application-error";
import { getInternalContext } from "../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Ticket Detail" };

/**
 * The management surface for one Ticket: details, Operations, Internal notes,
 * and the one Inbox control. The conversation itself lives in Inbox ->
 * Tickets (see components/tickets/ticket-workspace.tsx for why this route
 * renders no transcript).
 */
export default async function TicketDetailPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const [{ ticketId }, context] = await Promise.all([params, getInternalContext()]);
  try {
    const [detail, summaries, assignees] = await Promise.all([
      context.services.tickets.get(ticketId),
      context.services.tickets.list(),
      context.services.catalog.listAssignees(),
    ]);
    const ticket = detail.ticket;
    return (
      <PageFrame
        className={styles.ticketDetailPage}
        title={ticket.subject}
        description={<>Ticket <strong>{ticket.public_ref}</strong></>}
      >
        <TicketWorkspace
          ticketId={ticket.id}
          detail={detail}
          summaries={summaries}
          assignees={assignees}
          capabilities={context.user.tickets}
        />
      </PageFrame>
    );
  } catch (error) {
    if (toClientSafeError(error).code === "NOT_FOUND") notFound();
    throw error;
  }
}
