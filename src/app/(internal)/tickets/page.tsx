import type { Metadata } from "next";
import { TicketsList } from "../../../components/tickets/tickets-list";
import { PageFrame } from "../../../components/ui/page-frame";
import { getInternalContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Tickets" };

export default async function TicketsPage() {
  const context = await getInternalContext();
  const summaries = await context.services.tickets.list();
  return <PageFrame title="Tickets" description="Track client conversations, ownership, and resolution in one workspace."><TicketsList summaries={summaries} /></PageFrame>;
}
