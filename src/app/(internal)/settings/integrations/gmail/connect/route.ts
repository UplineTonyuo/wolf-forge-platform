import { NextRequest, NextResponse } from "next/server";
import { readGoogleOAuthEnvironment } from "../../../../../../lib/env/google-oauth-env";
import { createGmailIntegrationService } from "../../../../../../lib/integrations/gmail-server";
import {
  recordGmailCapabilityDenied,
  recordGmailOriginRejected,
  recordGmailRouteEvent,
} from "../../../../../../lib/integrations/gmail-observability";
import { requireIntegrationManager } from "../../../../../../lib/integrations/gmail-route-security";
import { createOAuthState, createPkcePair, GMAIL_OAUTH_STATE_COOKIE, GMAIL_OAUTH_VERIFIER_COOKIE } from "../../../../../../lib/integrations/oauth-state";
import { requestHasExpectedOrigin } from "../../../../../../lib/security/same-origin";
import { getInternalContext } from "../../../../../../lib/supabase/next-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const context = await getInternalContext();
  try {
    requireIntegrationManager(context.user.integrations.manage);
  } catch {
    await recordGmailCapabilityDenied({ action: "connect", actorId: context.actor.id });
    return new NextResponse("Forbidden", { status: 403 });
  }

  let environment;
  try {
    environment = readGoogleOAuthEnvironment();
  } catch {
    await recordGmailRouteEvent({
      event: "integration.gmail.not_configured",
      action: "connect",
      reason: "oauth_environment_missing",
      actorId: context.actor.id,
    });
    return new NextResponse("Gmail OAuth is not configured.", { status: 503 });
  }
  if (!requestHasExpectedOrigin(request, environment.GOOGLE_OAUTH_REDIRECT_URI)) {
    await recordGmailOriginRejected({ action: "connect", actorId: context.actor.id });
    return new NextResponse("Invalid request origin.", { status: 403 });
  }

  const state = createOAuthState();
  const pkce = createPkcePair();
  const authorizationUrl = createGmailIntegrationService(context.actor).authorizationUrl(state, pkce.challenge);
  const response = NextResponse.redirect(authorizationUrl, 303);
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: environment.GOOGLE_OAUTH_REDIRECT_URI.startsWith("https://"),
    path: "/settings/integrations/gmail/callback",
    maxAge: 600,
  };
  response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, state, cookieOptions);
  response.cookies.set(GMAIL_OAUTH_VERIFIER_COOKIE, pkce.verifier, cookieOptions);
  return response;
}
