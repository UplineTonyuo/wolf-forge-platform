import { ticketLiveRequestSchema } from "../../../domain/tickets/schema";
import { ticketConversationFingerprint } from "../../../domain/tickets/live-scheduler";
import { NotFoundError, toClientSafeError } from "../../../lib/errors/application-error";
import { readBoundedJson } from "../../../lib/security/bounded-json";
import { requestIsSameOrigin } from "../../../lib/security/same-origin";
import { getTicketActorContext } from "../../../lib/supabase/next-server";
import { identityFailureResponse } from "../../../lib/supabase/identity-failure-response";

export const dynamic = "force-dynamic";
const privateHeaders={"cache-control":"private, no-store, max-age=0"};

/**
 * The shared Ticket and Project conversation live lane.
 *
 * One conversation, one canonical read. Modeled on `/api/team-live`: same-origin
 * only, bounded JSON, a verified actor resolved from the HttpOnly session
 * cookie, and no actor identity, company or role supplied by the browser — so
 * there is no bearer token or subject for a caller to forge, and the route
 * grants nothing the page render would not.
 *
 * The payload is deliberately conditional. The caller sends the fingerprint it
 * already holds; when the conversation has not moved, the response carries the
 * fingerprint and **no messages at all**, so an idle open conversation costs a
 * few hundred bytes rather than a full transcript re-download. When it has
 * moved, the whole authoritative list comes back and the client adopts it
 * in place — no `router.refresh()`, no RSC round trip.
 *
 * Internal notes are not filtered here on purpose: `app_get_ticket_detail`
 * and the canonical Project conversation RPC refuse them to client actors in Postgres, and re-implementing
 * that rule in TypeScript would create a second, driftable copy of a security
 * boundary.
 */
export async function POST(request: Request) {
  const startedAt = performance.now();
  if (!requestIsSameOrigin(request)) {
    return Response.json({ ok: false, error: "Request refused." }, { status: 403,headers:privateHeaders });
  }

  const body = await readBoundedJson(request, 24 * 1024);
  if (!body.ok) {
    return Response.json({ ok: false, error: body.error }, { status: body.status,headers:privateHeaders });
  }

  const input = ticketLiveRequestSchema.safeParse(body.value);
  if (!input.success) {
    return Response.json({ ok: false, error: "Invalid Ticket live request." }, { status: 400,headers:privateHeaders });
  }

  const context = await getTicketActorContext().catch(identityFailureResponse);
  if (context instanceof Response) { const headers=new Headers(context.headers);headers.set("cache-control",privateHeaders["cache-control"]);return new Response(context.body,{status:context.status,headers}); }
  if (!context) {
    return Response.json({ ok: false, error: "Session expired." }, { status: 401,headers:privateHeaders });
  }

  try {
    const target = "order_id" in input.data
      ? { kind: "project" as const, id: input.data.order_id }
      : { kind: "ticket" as const, id: input.data.ticket_id };
    if (target.kind === "project") {
      const pageInput = "page" in input.data && input.data.page ? input.data.page : { direction: "refresh" as const, cursor: null, retainedIds: [], requestIds: [], fingerprint: null };
      const detail = await context.tickets.getOrderPage(target.id, { ...pageInput, fingerprint: pageInput.direction === "refresh" ? input.data.fingerprint : null });
      if(!detail)throw new NotFoundError("Conversation");
      return Response.json({ok:true,data:{orderId:target.id,fingerprint:detail.fingerprint,changed:detail.changed,
        messages:detail.changed?detail.messages:null,updates:detail.updates,page:detail.page,confirmedRequestIds:detail.confirmedRequestIds}},
      {headers:{"cache-control":"private, no-store, max-age=0","server-timing":`ticket-live;dur=${(performance.now()-startedAt).toFixed(1)}`}});
    }
    const detail = await context.tickets.get(target.id);
    if (!detail) throw new NotFoundError("Conversation");
    const messages = detail.messages ?? [];
    const fingerprint = ticketConversationFingerprint(messages);
    const changed = fingerprint !== input.data.fingerprint;

    return Response.json(
      {
        ok: true,
        data: {
          ticketId: target.id,
          fingerprint,
          changed,
          messages: changed ? messages : null,
        },
      },
      {
        headers: {
          "cache-control": "private, no-store, max-age=0",
          "server-timing": `ticket-live;dur=${(performance.now() - startedAt).toFixed(1)}`,
        },
      },
    );
  } catch (error) {
    const safe = toClientSafeError(error);
    return Response.json(
      { ok: false, error: safe.message, code: safe.code },
      {
        status: safe.code === "PERMISSION_DENIED" ? 403 : safe.code === "NOT_FOUND" ? 404 : safe.code === "RATE_LIMITED" ? 429 : 400,
        headers: { "cache-control": "private, no-store, max-age=0" },
      },
    );
  }
}
