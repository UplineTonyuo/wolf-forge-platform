import { teamSyncRequestSchema } from "../../../domain/team/schema";
import { toClientSafeError } from "../../../lib/errors/application-error";
import { readBoundedJson } from "../../../lib/security/bounded-json";
import { requestIsSameOrigin } from "../../../lib/security/same-origin";
import { recordTeamRouteRefusal } from "../../../lib/security/team-route-refusal";
import { getTeamActorContext } from "../../../lib/supabase/next-server";
import { identityFailureResponse } from "../../../lib/supabase/identity-failure-response";

export const dynamic = "force-dynamic";

/**
 * The background lane.
 *
 * The conversation list, the roster, the task lists and the offline digest
 * materializer — everything a viewer tolerates being a few seconds old. It runs
 * on a slow cadence and, crucially, on its own request, so none of this work
 * sits in front of the typing and new-message reads that /api/team-live serves.
 *
 * No longer a stream. Each branch already runs concurrently on the server, and
 * the ordering the NDJSON split existed to guarantee is now provided by the
 * lane split itself.
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

  const input = teamSyncRequestSchema.safeParse(body.value);
  if (!input.success) {
    return Response.json({ ok: false, error: "Invalid Team sync request." }, { status: 400 });
  }

  const context = await getTeamActorContext().catch(identityFailureResponse);
  if (context instanceof Response) return context;
  if (!context) {
    return Response.json({ ok: false, error: "Session expired." }, { status: 401 });
  }
  const contextMs = performance.now() - startedAt;

  try {
    const [conversations, tasks, members] = await Promise.all([
      input.data.includeConversations
        ? context.team.listConversations()
        : Promise.resolve(null),
      input.data.includeTasks
        ? context.team.listMyTasks(input.data.includeTeamTasks)
        : Promise.resolve(null),
      input.data.includeMembers ? context.team.listMembers() : Promise.resolve(null),
      input.data.materializeDigests
        ? context.team.materializeMessageDigests()
        : Promise.resolve(0),
    ]);

    return Response.json(
      { ok: true, data: { conversations, tasks, members, detail: null } },
      {
        headers: {
          "cache-control": "private, no-store, max-age=0",
          "server-timing":
            `team-context;dur=${contextMs.toFixed(1)}, ` +
            `team-sync;dur=${(performance.now() - startedAt).toFixed(1)}`,
        },
      },
    );
  } catch (error) {
    /*
     * An account the database refuses is the cross-surface attempt this
     * taxonomy exists for, so it is recorded even though the route itself
     * resolved no capability of its own.
     */
    await recordTeamRouteRefusal({ error, actorId: context.actor.id, surface: "team.sync" });
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
