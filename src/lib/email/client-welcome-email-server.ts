import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { readGoogleOAuthEnvironment } from "../env/google-oauth-env";
import { readServerEnvironment } from "../env/server-env";
import { mapDatabaseError } from "../errors/map-database-error";
import { createGmailIntegrationService, isGmailIntegrationConfigured } from "../integrations/gmail-server";
import { GmailReauthorizationRequiredError, type GmailMessage } from "../integrations/google-oauth-client";
import type { getInternalContext } from "../supabase/next-server";
import { createTrustedServerSupabaseClient } from "../supabase/trusted-server-client";
import type { VerifiedActor } from "../supabase/user-client";
import { clientWelcomeEmail } from "./client-welcome-email";

export type ClientWelcomeEmailOutcome = "sent" | "failed" | "in_progress" | "recently_sent" | "activated";

type Claim =
  | { outcome: "claimed"; email: string; name: string | null }
  | { outcome: ClientWelcomeEmailOutcome };

export type ClientWelcomeEmailDependencies = {
  /** Also stores `tokenHash` as the client's only live link. */
  claim(profileId: string, requestId: string, tokenHash: string): Promise<Claim>;
  /** `null` records a send Gmail accepted. */
  finish(profileId: string, requestId: string, failureCode: string | null): Promise<void>;
  send(message: GmailMessage): Promise<string>;
  /** This deployment's public origin, e.g. https://portal.example.com. */
  origin: string;
};

export function hashActivationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Sends one welcome email carrying a single-use set-password link.
 *
 * The claim/finish RPCs (20260924120000_client_welcome_email.sql) make this
 * safe to retry: one send in flight per client, a cooldown after a success,
 * and a replayed request id reports its first outcome instead of sending
 * again. The link's SHA-256 is stored by the claim, before Gmail sees the
 * message, so a delivered link works even if every later write fails.
 */
export async function sendClientWelcomeEmail(
  profileId: string,
  requestId: string,
  dependencies: ClientWelcomeEmailDependencies,
): Promise<ClientWelcomeEmailOutcome> {
  const token = randomBytes(32).toString("base64url");
  const claim = await dependencies.claim(profileId, requestId, hashActivationToken(token));
  if (claim.outcome !== "claimed") return claim.outcome;

  try {
    const message = clientWelcomeEmail({
      name: claim.name,
      email: claim.email,
      // A URL fragment never reaches a server, so the token stays out of request logs.
      activationUrl: `${dependencies.origin}/activate#token=${token}`,
    });
    await dependencies.send({ ...message, to: claim.email });
  } catch (error) {
    await dependencies.finish(
      profileId,
      requestId,
      error instanceof GmailReauthorizationRequiredError ? "gmail_reauthorization_required" : "gmail_delivery_failed",
    );
    return "failed";
  }

  // Gmail has the message and its link is already live; losing this write only
  // leaves the row "sending", whose lease still blocks a resend.
  await dependencies.finish(profileId, requestId, null).catch(() => undefined);
  return "sent";
}

export function createClientWelcomeEmailDependencies(actor: VerifiedActor): ClientWelcomeEmailDependencies {
  const trusted = createTrustedServerSupabaseClient(readServerEnvironment());
  const gmail = createGmailIntegrationService(actor);

  return {
    async claim(profileId, requestId, tokenHash) {
      const { data, error } = await trusted.rpc("app_server_claim_client_welcome_email", {
        p_actor_id: actor.id,
        p_profile_id: profileId,
        p_request_id: requestId,
        p_token_hash: tokenHash,
      });
      if (error) throw mapDatabaseError(error, "Welcome email");
      const row = data[0];
      if (!row) throw new Error("The welcome email claim returned nothing.");
      return row.outcome === "claimed"
        ? { outcome: "claimed", email: row.recipient_email, name: row.recipient_name }
        : { outcome: row.outcome as ClientWelcomeEmailOutcome };
    },
    async finish(profileId, requestId, failureCode) {
      const { error } = await trusted.rpc("app_server_finish_client_welcome_email", {
        p_actor_id: actor.id,
        p_profile_id: profileId,
        p_request_id: requestId,
        ...(failureCode ? { p_failure_code: failureCode } : {}),
      });
      if (error) throw mapDatabaseError(error, "Welcome email");
    },
    send: (message) => gmail.send(message),
    // The OAuth redirect URI is this deployment's validated public origin (https outside local dev).
    origin: new URL(readGoogleOAuthEnvironment().GOOGLE_OAUTH_REDIRECT_URI).origin,
  };
}

/**
 * Presentation gate for the checkbox and the resend action. The claim RPC and
 * the Gmail credential RPC enforce the same two permissions in the database.
 */
export async function canSendClientWelcomeEmail(
  context: Awaited<ReturnType<typeof getInternalContext>>,
): Promise<boolean> {
  if (!context.user.clients.privateManage || !context.user.integrations.manage) return false;
  if (!isGmailIntegrationConfigured()) return false;
  const connections = await context.services.integrations.listConnections().catch(() => []);
  return connections.some((connection) => connection.provider.id === "gmail" && connection.status === "connected");
}
