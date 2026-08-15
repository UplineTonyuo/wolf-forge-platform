import type { Metadata } from "next";
import { TicketsList } from "../../../components/tickets/tickets-list";
import { PageFrame } from "../../../components/ui/page-frame";
import { getInternalContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Tickets" };

export default async function TicketsPage() {
  const context = await getInternalContext();
  const [summaries, companies] = await Promise.all([
    context.services.tickets.list(),
    context.services.companies.listActive(),
  ]);

  return (
    <PageFrame
      title="Tickets"
      description="Track client conversations, ownership, and resolution in one workspace."
    >
      <TicketsList
        summaries={summaries}
        companies={companies.map((company) => ({
          id: company.id,
          name: company.name,
        }))}
        canCreate={context.user.tickets.create}
      />
    </PageFrame>
  );
}
