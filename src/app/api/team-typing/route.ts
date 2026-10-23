import { teamTypingRequestSchema } from "../../../domain/team/schema";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { readBoundedJson } from "../../../lib/security/bounded-json";
import { requestIsSameOrigin } from "../../../lib/security/same-origin";
import { recordTeamRouteRefusal } from "../../../lib/security/team-route-refusal";
import { getTeamActorContext } from "../../../lib/supabase/next-server";
import { identityFailureResponse } from "../../../lib/supabase/identity-failure-response";

export const dynamic = "force-dynamic";

/**
 * A keystroke's worth of work.
 *
 * The first character typed should reach the other side, so this pays the
 * smallest authorization the boundary allows and makes one RPC call.
 * app_touch_team_typing derives the profile from auth.uid(); the browser
 * supplies only an opaque connection id that distinguishes its own tab.
 */
export async function POST(request: Request) {
  const startedAt = performance.now();
  if (!requestIsSameOrigin(request)) {
    return Response.json({ ok: false, error: "Request refused." }, { status: 403 });
  }

  const body = await readBoundedJson(request, 4 * 1024);
  if (!body.ok) {
    return Response.json({ ok: false, error: body.error }, { status: body.status });
  }

  const input = teamTypingRequestSchema.safeParse(body.value);
  if (!input.success) {
    return Response.json({ ok: false, error: "Invalid typing request." }, { status: 400 });
  }

  const context = await getTeamActorContext().catch(identityFailureResponse);
  if (context instanceof Response) return context;
  if (!context) {
    return Response.json({ ok: false, error: "Session expired." }, { status: 401 });
  }
  const contextMs = performance.now() - startedAt;

  try {
    const payload = {
      conversationId: input.data.conversationId,
      connectionId: input.data.connectionId,
    };
    if (input.data.operation === "touch") {
      await context.team.touchTyping(payload, context.actor);
    } else {
      await context.team.clearTyping(payload, context.actor);
    }

    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "server-timing":
          `team-context;dur=${contextMs.toFixed(1)}, ` +
          `team-typing;dur=${(performance.now() - startedAt).toFixed(1)}`,
      },
    });
  } catch (error) {
    /*
     * An account the database refuses is the cross-surface attempt this
     * taxonomy exists for, so it is recorded even though the route itself
     * resolved no capability of its own.
     */
    await recordTeamRouteRefusal({ error, actorId: context.actor.id, surface: "team.typing" });
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
