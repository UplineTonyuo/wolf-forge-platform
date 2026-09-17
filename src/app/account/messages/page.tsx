import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClientMessages } from "../../../components/account/messages/client-messages";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { readClientTickets } from "../../../lib/supabase/client-portal-data";
import { getClientContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Messages" };

export default async function ClientMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ compose?: string; from?: string }>;
}) {
  const [{ compose, from }, { services }] = await Promise.all([
    searchParams,
    getClientContext(),
  ]);

  let denied = false;
  let loadError: string | null = null;
  let summaries = null;

  try {
    await services.permissions.requireModuleAccess("portal_tickets");
    /*
     * readClientTickets narrows the internal TicketSummary to the client-safe
     * projection at the data edge, so assignee and company identity never reach
     * this component to begin with.
     */
    summaries = await readClientTickets();
  } catch (error) {
    const safe = toClientSafeError(error);
    if (safe.code === "PERMISSION_DENIED") denied = true;
    else loadError = safe.message || "Messages could not be loaded.";
  }

  if (denied) redirect("/account");

  if (loadError) {
    return (
      <div className="portal-page">
        <header className="portal-page-head">
          <h1>Messages</h1>
        </header>
        <p className="portal-empty">{loadError}</p>
      </div>
    );
  }

  /*
   * ?compose=1 is how the command bar's quick action reaches this page from
   * elsewhere in the portal. It only opens the composer and grants nothing.
   *
   * ?from=cart additionally asks the composer to seed itself from the request
   * cart. The cart lives in the browser, so no data travels in the URL and no
   * new read is authorised — the flag only says where the client came from.
   */
  return (
    <ClientMessages
      summaries={summaries ?? []}
      composeOnMount={compose === "1"}
      seedFromCart={from === "cart"}
    />
  );
}
