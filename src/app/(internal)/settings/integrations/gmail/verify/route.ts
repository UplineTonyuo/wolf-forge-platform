import { NextRequest, NextResponse } from "next/server";
import { readGoogleOAuthEnvironment } from "../../../../../../lib/env/google-oauth-env";
import { recordGmailLifecycleAudit } from "../../../../../../lib/integrations/gmail-audit";
import { GmailReauthorizationRequiredError } from "../../../../../../lib/integrations/google-oauth-client";
import { createGmailIntegrationService } from "../../../../../../lib/integrations/gmail-server";
import {
  recordGmailCapabilityDenied,
  recordGmailOriginRejected,
  recordGmailRouteEvent,
} from "../../../../../../lib/integrations/gmail-observability";
import { requireIntegrationManager } from "../../../../../../lib/integrations/gmail-route-security";
import { requestHasExpectedOrigin } from "../../../../../../lib/security/same-origin";
import { enforceServerCostLimit } from "../../../../../../lib/security/server-cost-limit";
import { ApplicationError } from "../../../../../../lib/errors/application-error";
import { getInternalContext } from "../../../../../../lib/supabase/next-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const context = await getInternalContext();
  try { requireIntegrationManager(context.user.integrations.manage); } catch {
    await recordGmailCapabilityDenied({ action: "verify", actorId: context.actor.id });
    return new NextResponse("Forbidden", { status: 403 });
  }
  let environment;
  try { environment = readGoogleOAuthEnvironment(); } catch {
    await recordGmailRouteEvent({
      event: "integration.gmail.not_configured",
      action: "verify",
      reason: "oauth_environment_missing",
      actorId: context.actor.id,
    });
    return new NextResponse("Gmail OAuth is not configured.", { status: 503 });
  }
  if (!requestHasExpectedOrigin(request, environment.GOOGLE_OAUTH_REDIRECT_URI)) {
    await recordGmailOriginRejected({ action: "verify", actorId: context.actor.id });
    return new NextResponse("Invalid request origin.", { status: 403 });
  }

  try {
    await enforceServerCostLimit({
      actorId: context.actor.id,
      action: "integration.gmail.verify",
    });
  } catch (error) {
    return new NextResponse(
      error instanceof ApplicationError && error.code === "RATE_LIMITED"
        ? "Too many requests. Please wait a moment and try again."
        : "Verification is temporarily unavailable.",
      { status: error instanceof ApplicationError && error.code === "RATE_LIMITED" ? 429 : 503 },
    );
  }

  const redirect = new URL("/settings/integrations", environment.GOOGLE_OAUTH_REDIRECT_URI);
  redirect.hash = "gmail";
  try {
    await createGmailIntegrationService(context.actor).verify();
    redirect.searchParams.set("gmail", "verified");
  } catch (error) {
    /*
     * `GmailReauthorizationRequiredError` is the observable face of a refresh
     * that came back `invalid_grant`, or of a stored identity that no longer
     * matches the mailbox. It is expected — consent gets revoked — but it is
     * exactly the state a silently-broken integration sits in, so it gets its
     * own code rather than sharing one with a genuine failure.
     *
     * Neither branch touches the error's message or the refresh token.
     */
    const expired = error instanceof GmailReauthorizationRequiredError;
    await recordGmailRouteEvent({
      event: expired
        ? "integration.gmail.reauthorization_required"
        : "integration.gmail.verify_failed",
      action: "verify",
      reason: expired ? "reauthorization_required" : "verification_failed",
      actorId: context.actor.id,
      outcome: expired ? "denied" : "failed",
    });
    if (expired) {
      /*
       * Security C2-5. The connection just degraded — consent revoked or the
       * mailbox identity drifted. That is a durable credential-state
       * transition worth reconstructing later; an ordinary verify failure is
       * not, and stays a log line only.
       */
      await recordGmailLifecycleAudit({
        event: "integration.gmail.reauthorization_required",
        action: "verify",
        actorId: context.actor.id,
        outcome: "denied",
      });
    }
    redirect.searchParams.set("gmail", expired ? "reauthorize" : "verify-error");
  }
  return NextResponse.redirect(redirect, 303);
}
