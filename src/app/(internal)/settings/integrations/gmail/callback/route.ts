import { NextRequest, NextResponse } from "next/server";
import type { SecurityEventCode } from "../../../../../../domain/security/event-codes";
import { readGoogleOAuthEnvironment } from "../../../../../../lib/env/google-oauth-env";
import { recordGmailLifecycleAudit } from "../../../../../../lib/integrations/gmail-audit";
import { createGmailIntegrationService } from "../../../../../../lib/integrations/gmail-server";
import {
  recordGmailCapabilityDenied,
  recordGmailRouteEvent,
} from "../../../../../../lib/integrations/gmail-observability";
import { requireIntegrationManager } from "../../../../../../lib/integrations/gmail-route-security";
import { GMAIL_OAUTH_STATE_COOKIE, GMAIL_OAUTH_VERIFIER_COOKIE, validateGmailCallback } from "../../../../../../lib/integrations/oauth-state";
import { getInternalContext } from "../../../../../../lib/supabase/next-server";

export const runtime = "nodejs";

/**
 * A mismatched `state` is the single most attack-shaped event in this product —
 * a failed CSRF or authorization-code injection attempt against the one route
 * that turns a browser redirect into a stored Google refresh token. Before
 * Security C2-4 it produced a redirect and nothing else.
 *
 * The authorization code, the state value and the PKCE verifier are never
 * passed to the logger on any branch.
 */
const CALLBACK_FAILURE_EVENTS: Record<
  "state-error" | "provider-error" | "callback-error",
  SecurityEventCode
> = {
  "state-error": "integration.gmail.oauth_state_mismatch",
  "provider-error": "integration.gmail.oauth_provider_denied",
  "callback-error": "integration.gmail.oauth_callback_invalid",
};

function settingsRedirect(origin: string, result: string): NextResponse {
  const url = new URL("/settings/integrations", origin);
  url.searchParams.set("gmail", result);
  url.hash = "gmail";
  const response = NextResponse.redirect(url, 303);
  response.cookies.delete({ name: GMAIL_OAUTH_STATE_COOKIE, path: "/settings/integrations/gmail/callback" });
  response.cookies.delete({ name: GMAIL_OAUTH_VERIFIER_COOKIE, path: "/settings/integrations/gmail/callback" });
  return response;
}

export async function GET(request: NextRequest) {
  let environment;
  try {
    environment = readGoogleOAuthEnvironment();
  } catch {
    await recordGmailRouteEvent({
      event: "integration.gmail.not_configured",
      action: "callback",
      reason: "oauth_environment_missing",
    });
    return new NextResponse("Gmail OAuth is not configured.", { status: 503 });
  }

  const validation = validateGmailCallback({
    expectedState: request.cookies.get(GMAIL_OAUTH_STATE_COOKIE)?.value,
    receivedState: request.nextUrl.searchParams.get("state"),
    verifier: request.cookies.get(GMAIL_OAUTH_VERIFIER_COOKIE)?.value,
    code: request.nextUrl.searchParams.get("code"),
    providerError: request.nextUrl.searchParams.has("error"),
  });
  if (!validation.ok) {
    await recordGmailRouteEvent({
      event: CALLBACK_FAILURE_EVENTS[validation.result],
      action: "callback",
      reason: validation.result.replaceAll("-", "_"),
    });
    return settingsRedirect(environment.GOOGLE_OAUTH_REDIRECT_URI, validation.result);
  }

  const context = await getInternalContext();
  try {
    requireIntegrationManager(context.user.integrations.manage);
  } catch {
    await recordGmailCapabilityDenied({ action: "callback", actorId: context.actor.id });
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    await createGmailIntegrationService(context.actor).completeAuthorization(validation.code, validation.verifier);
    /*
     * Security C2-5. A successful connect is a durable external-credential
     * state change: the audit trail must answer "when was this provider
     * connected, and by whom". Awaited before the redirect for symmetry with
     * every other audited boundary; it cannot throw.
     */
    await recordGmailLifecycleAudit({
      event: "integration.gmail.connected",
      action: "callback",
      actorId: context.actor.id,
      outcome: "succeeded",
    });
    return settingsRedirect(environment.GOOGLE_OAUTH_REDIRECT_URI, "connected");
  } catch {
    /*
     * The caught error can carry a Google response body. It is deliberately not
     * read: the event says the exchange failed, and nothing more.
     */
    await recordGmailRouteEvent({
      event: "integration.gmail.connect_failed",
      action: "callback",
      reason: "authorization_exchange_failed",
      actorId: context.actor.id,
      outcome: "failed",
    });
    return settingsRedirect(environment.GOOGLE_OAUTH_REDIRECT_URI, "connection-error");
  }
}
