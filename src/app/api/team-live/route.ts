import { teamLiveRequestSchema } from "../../../domain/team/schema";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { readBoundedJson } from "../../../lib/security/bounded-json";
import { requestIsSameOrigin } from "../../../lib/security/same-origin";
import { recordTeamRouteRefusal } from "../../../lib/security/team-route-refusal";
import { getTeamActorContext } from "../../../lib/supabase/next-server";

export const dynamic = "force-dynamic";

/**
 * The fast lane.
 *
 * Everything a viewer perceives as immediate — a colleague typing, a message
 * arriving — is answered here, and nothing else is. It runs the minimum
 * authorization the boundary requires (one verified actor, no profile, no
 * permission map, no module map) and makes exactly ONE database call.
 *
 * Plain JSON on purpose. V2.1 streamed NDJSON so that active-conversation
 * detail could be written before the slower list, roster and task work
 * finished; measured, that split was worth single-digit milliseconds, and it
 * depended on no proxy between the function and the browser buffering the early
 * chunk. Splitting the work into two lanes achieves what the stream was meant
 * to achieve, without depending on how a proxy treats a partial response.
 *
 * The browser receives no Supabase bearer token and supplies no actor identity.
 */
export async function POST(request: Request) {
  const startedAt = performance.now();
  if (!requestIsSameOrigin(request)) {
    return Response.json({ ok: false, error: "Request refused." }, { status: 403 });
  }

  const body = await readBoundedJson(request, 8 * 1024);
  if (!body.ok) {
    return Response.json({ ok: false, error: body.error }, { status: body.status });
  }

  const input = teamLiveRequestSchema.safeParse(body.value);
  if (!input.success) {
    return Response.json({ ok: false, error: "Invalid Team request." }, { status: 400 });
  }

  const context = await getTeamActorContext();
  if (!context) {
    return Response.json({ ok: false, error: "Session expired." }, { status: 401 });
  }
  const contextMs = performance.now() - startedAt;

  try {
    const data = await context.team.liveSync(input.data);
    return Response.json(
      { ok: true, data },
      {
        headers: {
          "cache-control": "private, no-store, max-age=0",
          "server-timing":
            `team-context;dur=${contextMs.toFixed(1)}, ` +
            `team-live;dur=${(performance.now() - startedAt).toFixed(1)}`,
        },
      },
    );
  } catch (error) {
    /*
     * An account the database refuses is the cross-surface attempt this
     * taxonomy exists for, so it is recorded even though the route itself
     * resolved no capability of its own.
     */
    await recordTeamRouteRefusal({ error, actorId: context.actor.id, surface: "team.live" });
    const safe = toClientSafeError(error);
    return Response.json(
      { ok: false, error: safe.message },
      {
        status: safe.code === "RATE_LIMITED" ? 429 : 400,
        headers: { "cache-control": "private, no-store, max-age=0" },
      },
    );
  }
}
