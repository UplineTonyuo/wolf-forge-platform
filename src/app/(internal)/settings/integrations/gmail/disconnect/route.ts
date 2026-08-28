import { NextRequest, NextResponse } from "next/server";
import { readGoogleOAuthEnvironment } from "../../../../../../lib/env/google-oauth-env";
import { recordGmailLifecycleAudit } from "../../../../../../lib/integrations/gmail-audit";
import { createGmailIntegrationService } from "../../../../../../lib/integrations/gmail-server";
import {
  recordGmailCapabilityDenied,
  recordGmailOriginRejected,
  recordGmailRouteEvent,
} from "../../../../../../lib/integrations/gmail-observability";
import { requireIntegrationManager } from "../../../../../../lib/integrations/gmail-route-security";
import { requestHasExpectedOrigin } from "../../../../../../lib/security/same-origin";
import { getInternalContext } from "../../../../../../lib/supabase/next-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const context = await getInternalContext();
  try { requireIntegrationManager(context.user.integrations.manage); } catch {
    await recordGmailCapabilityDenied({ action: "disconnect", actorId: context.actor.id });
    return new NextResponse("Forbidden", { status: 403 });
  }
  let environment;
  try { environment = readGoogleOAuthEnvironment(); } catch {
    await recordGmailRouteEvent({
      event: "integration.gmail.not_configured",
      action: "disconnect",
      reason: "oauth_environment_missing",
      actorId: context.actor.id,
    });
    return new NextResponse("Gmail OAuth is not configured.", { status: 503 });
  }
  if (!requestHasExpectedOrigin(request, environment.GOOGLE_OAUTH_REDIRECT_URI)) {
    await recordGmailOriginRejected({ action: "disconnect", actorId: context.actor.id });
    return new NextResponse("Invalid request origin.", { status: 403 });
  }

  const redirect = new URL("/settings/integrations", environment.GOOGLE_OAUTH_REDIRECT_URI);
  redirect.hash = "gmail";
  try {
    await createGmailIntegrationService(context.actor).disconnect();
    /*
     * Security C2-5. Removing the platform's external credential is a durable
     * state change; the audit trail must answer "when was Gmail disconnected,
     * and by whom".
     */
    await recordGmailLifecycleAudit({
      event: "integration.gmail.disconnected",
      action: "disconnect",
      actorId: context.actor.id,
      outcome: "succeeded",
    });
    redirect.searchParams.set("gmail", "disconnected");
  } catch {
    /*
     * A failed disconnect is worth an error-level event even though the user
     * sees only a generic banner: it can mean the local credential is gone but
     * Google was never told, or the reverse. Either leaves a live grant nobody
     * can see in the UI.
     *
     * Security C2-5: that ambiguity is exactly what makes this failure
     * AUDIT-worthy as well as logged — it is a possible live-but-invisible
     * grant, which no other record would surface later.
     */
    await recordGmailRouteEvent({
      event: "integration.gmail.disconnect_failed",
      action: "disconnect",
      reason: "disconnect_failed",
      actorId: context.actor.id,
      outcome: "failed",
    });
    await recordGmailLifecycleAudit({
      event: "integration.gmail.disconnect_failed",
      action: "disconnect",
      actorId: context.actor.id,
      outcome: "failed",
    });
    redirect.searchParams.set("gmail", "disconnect-error");
  }
  return NextResponse.redirect(redirect, 303);
}
