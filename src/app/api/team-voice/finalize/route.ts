import { toClientSafeError } from "../../../../lib/errors/application-error";
import { readBoundedJson } from "../../../../lib/security/bounded-json";
import { requestIsSameOrigin } from "../../../../lib/security/same-origin";
import { getInternalActorContext } from "../../../../lib/supabase/next-server";
import { identityFailureResponse } from "../../../../lib/supabase/identity-failure-response";
import { createTeamVoiceService } from "../../../../lib/team-voice/server-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return Response.json({ ok: false, error: "Request refused." }, { status: 403 });
  const body = await readBoundedJson(request, 4 * 1024);
  if (!body.ok) return Response.json({ ok: false, error: body.error }, { status: body.status });
  const context = await getInternalActorContext().catch(identityFailureResponse);
  if (context instanceof Response) return context;
  if (!context) return Response.json({ ok: false, error: "Session expired." }, { status: 401 });
  try {
    const data = await createTeamVoiceService(context.client).finalizeUpload(body.value, context.actor);
    return Response.json({ ok: true, data }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const safe = toClientSafeError(error);
    return Response.json(
      { ok: false, error: safe.message },
      { status: safe.code === "PERMISSION_DENIED" ? 403 : safe.code === "RATE_LIMITED" ? 429 : 400 },
    );
  }
}
