import { ticketLiveRequestSchema } from "../../../domain/tickets/schema";
import { ticketConversationFingerprint } from "../../../domain/tickets/live-scheduler";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { readBoundedJson } from "../../../lib/security/bounded-json";
import { requestIsSameOrigin } from "../../../lib/security/same-origin";
import { getTicketActorContext } from "../../../lib/supabase/next-server";
import { identityFailureResponse } from "../../../lib/supabase/identity-failure-response";

export const dynamic = "force-dynamic";

/**
 * The Ticket conversation's live lane.
 *
 * One Ticket, one call, one read. Modeled on `/api/team-live`: same-origin
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
 * already refuses them to a client actor inside Postgres, and re-implementing
 * that rule in TypeScript would create a second, driftable copy of a security
 * boundary.
 */
export async function POST(request: Request) {
  const startedAt = performance.now();
  if (!requestIsSameOrigin(request)) {
    return Response.json({ ok: false, error: "Request refused." }, { status: 403 });
  }

  const body = await readBoundedJson(request, 24 * 1024);
  if (!body.ok) {
    return Response.json({ ok: false, error: body.error }, { status: body.status });
  }

  const input = ticketLiveRequestSchema.safeParse(body.value);
  if (!input.success) {
    return Response.json({ ok: false, error: "Invalid Ticket live request." }, { status: 400 });
  }

  const context = await getTicketActorContext().catch(identityFailureResponse);
  if (context instanceof Response) return context;
  if (!context) {
    return Response.json({ ok: false, error: "Session expired." }, { status: 401 });
  }

  try {
    const detail = await context.tickets.get(input.data.ticket_id);
    const messages = detail.messages ?? [];
    const fingerprint = ticketConversationFingerprint(messages);
    const changed = fingerprint !== input.data.fingerprint;

    return Response.json(
      {
        ok: true,
        data: {
          ticketId: input.data.ticket_id,
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
