import { teamPresenceConnectionSchema } from "../../../../domain/team/schema";
import { readBoundedJson } from "../../../../lib/security/bounded-json";
import { requestIsSameOrigin } from "../../../../lib/security/same-origin";
import { getTeamActorContext } from "../../../../lib/supabase/next-server";

/**
 * Best-effort page-exit cleanup for one browser tab. Stale expiry remains the
 * correctness fallback because page-exit delivery is never guaranteed.
 */
export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) {
    return new Response(null, { status: 403 });
  }

  const body = await readBoundedJson(request, 2 * 1024);
  if (!body.ok) return new Response(null, { status: body.status });

  const payload = teamPresenceConnectionSchema.safeParse(body.value);
  if (!payload.success) return new Response(null, { status: 400 });

  try {
    const context = await getTeamActorContext();
    if (!context) return new Response(null, { status: 401 });
    await context.team.disconnectPresence(payload.data, context.actor);
  } catch {
    // Disconnect is advisory. The 90-second freshness window is authoritative.
  }

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
