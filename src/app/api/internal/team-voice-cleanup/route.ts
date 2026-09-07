import { timingSafeEqual } from "node:crypto";
import { readTeamVoiceCleanupSecret } from "../../../../lib/env/team-voice-env";
import { createTeamVoiceCleanupService } from "../../../../lib/team-voice/server-service";
import { recordSecurityEvent } from "../../../../lib/security/security-log";

export const dynamic = "force-dynamic";

function authorized(request: Request, secret: string): boolean {
  const presented = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const actual = Buffer.from(secret);
  const candidate = Buffer.from(presented);
  return actual.length === candidate.length && timingSafeEqual(actual, candidate);
}

export async function GET(request: Request) {
  const secret = readTeamVoiceCleanupSecret();
  if (!secret) return Response.json({ ok: false, error: "Cleanup is not configured." }, { status: 503 });
  if (!authorized(request, secret)) return Response.json({ ok: false, error: "Request refused." }, { status: 401 });

  const result = await createTeamVoiceCleanupService().runBatch(100);
  // Counts only: never log message bodies, audio, quotes, paths, or searches.
  recordSecurityEvent({
    event: "system.team_voice_cleanup.completed",
    actorClass: "internal",
    resourceType: "team_voice_cleanup_batch",
    outcome: "succeeded",
    metadata: result,
  });
  return Response.json({ ok: true, data: result }, { headers: { "cache-control": "private, no-store" } });
}
