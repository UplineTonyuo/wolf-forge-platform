"use server";

import { redirect } from "next/navigation";
import { clientSupportExitPending, clientSupportRequested } from "../../lib/supabase/client-support";
import { clearSignedOutClientSupport } from "../../lib/supabase/client-support-recovery";
import { endClientSupportAction } from "./client-support";
import {
  isCredentialStageFailure,
  resolveSignInSurface,
  signInFailure,
  signInUnassigned,
} from "../../domain/auth/login-flow";
import { safeAccountNextPath, safeNextPath } from "../../domain/auth/safe-next-path";
import {
  classifySignInFailure,
  safeProviderCode,
} from "../../domain/security/error-classification";
import type { SecurityEventCode } from "../../domain/security/event-codes";
import { currentCorrelationId } from "../../lib/security/request-correlation";
import { recordSecurityAuditEvent } from "../../lib/security/security-audit-log";
import { recordSecurityEvent } from "../../lib/security/security-log";
import {
  beginProtectedLogin,
  clearProtectedLoginPairFailures,
  recordProtectedLoginFailure,
} from "../../lib/security/login-protection";
import { ApplicationError } from "../../lib/errors/application-error";
import {
  createNextServerSignInSupabaseClient,
  createNextServerSupabaseClient,
  readLocalFrontendEnvironment,
  requestTenantSelector,
  resolveClientUser,
  resolveInternalUser,
} from "../../lib/supabase/next-server";
import { createUserSupabaseClient, verifyActor } from "../../lib/supabase/user-client";
import { IDENTITY_UNAVAILABLE_MESSAGE, IdentityLookupError } from "../../lib/supabase/identity-lookup";
import { clientPushAvailable } from "../../domain/notifications/push";
import { recordIdentityUnavailable } from "../../lib/supabase/identity-failure-response";

export type LoginState = { error: string | null };

const SIGN_IN_FAILURE_EVENTS: Record<
  ReturnType<typeof classifySignInFailure>,
  SecurityEventCode
> = {
  credentials: "auth.login.failed",
  rate_limited: "auth.login.rate_limited",
  provider_error: "auth.login.provider_error",
};

export async function signInAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  if ((await clientSupportRequested() || await clientSupportExitPending()) && !await clearSignedOutClientSupport()) {
    return { error: "Exit client support before signing into another account." };
  }
  // The host's Tenant (WL-2.22b), read before any Auth work so a request
  // without one fails closed instead of leaving a half-made session behind.
  const tenantSelector = await requestTenantSelector();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  // Bound attacker-controlled strings before bot, database or Auth work. The
  // response stays identical to every other credential-stage refusal.
  if (!email || email.length > 320 || !password || password.length > 1024) {
    return signInFailure();
  }

  let protection;
  try {
    protection = await beginProtectedLogin(email);
  } catch (error) {
    recordSecurityEvent({
      event:
        error instanceof ApplicationError && error.code === "RATE_LIMITED"
          ? "auth.login.rate_limited"
          : "auth.login.provider_error",
      correlationId: await currentCorrelationId(),
      actorClass: "anonymous",
      outcome: "denied",
      metadata: { action: "auth.sign_in", stage: "preflight" },
    });
    return signInFailure();
  }

  if (!protection.ok) {
    recordSecurityEvent({
      event: protection.reason === "bot" ? "auth.login.bot_blocked" : "auth.login.provider_error",
      correlationId: await currentCorrelationId(),
      actorClass: "anonymous",
      outcome: "denied",
      metadata: { action: "auth.sign_in", stage: "bot_or_limiter" },
    });
    return signInFailure();
  }

  const supabase = await createNextServerSignInSupabaseClient(
    protection.context?.forwardedIp ?? null,
  );
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  // Every credential-stage failure collapses to one message in login-flow.ts.
  // The provider error is passed for intent, never read into the response.
  if (!data.session || isCredentialStageFailure({ error, session: data.session })) {
    let applicationLimited = false;
    try {
      await recordProtectedLoginFailure(protection.context);
    } catch (limitError) {
      applicationLimited =
        limitError instanceof ApplicationError && limitError.code === "RATE_LIMITED";
    }

    /*
     * Security C2-4 / KI-029. The BROWSER still receives exactly one
     * non-enumerating message — that is asserted by
     * `login-brute-force-boundaries.test.ts` and is not traded away here. What
     * changes is that the server now records WHICH kind of failure it was.
     *
     * This matters because every `signInWithPassword` reaches Supabase Auth
     * from the application server's egress IP, so the provider's per-IP bucket
     * is shared platform-wide. When it trips, every legitimate user is told
     * their password is wrong. Without `auth.login.rate_limited` as a distinct
     * code, a total login outage and a typo look identical from every angle.
     *
     * No email, no password, no provider prose. The provider's own error code
     * is a bounded machine token (`safeProviderCode` refuses anything else) and
     * is identical for every account, so it enumerates nothing.
     */
    const failure = classifySignInFailure(error);
    recordSecurityEvent({
      event: applicationLimited ? "auth.login.rate_limited" : SIGN_IN_FAILURE_EVENTS[failure],
      correlationId: await currentCorrelationId(),
      actorClass: "anonymous",
      outcome: "denied",
      metadata: {
        action: "auth.sign_in",
        stage: "credentials",
        ...(failure === "credentials" ? {} : { provider_code: safeProviderCode(error) }),
      },
    });

    if (protection.context?.identityTargeted) {
      recordSecurityEvent({
        event: "auth.login.identity_targeted",
        correlationId: await currentCorrelationId(),
        actorClass: "anonymous",
        outcome: "denied",
        metadata: { action: "auth.sign_in", stage: "credentials" },
      });
    }

    return signInFailure(error);
  }

  // Cleanup is not authorization and must never turn valid credentials into a
  // login outage. The source/global risk history intentionally remains.
  await clearProtectedLoginPairFailures(protection.context).catch(() => undefined);

  const client = createUserSupabaseClient(
    readLocalFrontendEnvironment(),
    data.session.access_token,
    tenantSelector,
  );
  let actor;
  let internalUser;
  let clientUser;
  try {
    actor = await verifyActor(client);
    internalUser = await resolveInternalUser(client, actor);
    if (!internalUser) clientUser = await resolveClientUser(client, actor);
  } catch (error) {
    if (!(error instanceof IdentityLookupError)) throw error;
    if (error.kind === "unavailable") {
      await recordIdentityUnavailable(error);
      return { error: IDENTITY_UNAVAILABLE_MESSAGE };
    }
    await supabase.auth.signOut();
    return signInFailure();
  }
  if (resolveSignInSurface({ hasInternalUser: Boolean(internalUser), hasClientUser: false }) === "internal") {
    recordSecurityEvent({
      event: "auth.login.succeeded",
      correlationId: await currentCorrelationId(),
      actorId: actor?.id,
      actorClass: "internal",
      outcome: "succeeded",
      metadata: { action: "auth.sign_in" },
    });
    redirect(safeNextPath(formData.get("next")));
  }

  if (resolveSignInSurface({ hasInternalUser: false, hasClientUser: Boolean(clientUser) }) !== "client") {
    /*
     * The password was correct but the account belongs to no surface. Worth a
     * warn: this is what a half-provisioned or de-provisioned account looks
     * like, and it is safe to distinguish because the caller already proved
     * possession of the credential.
     *
     * Security C2-5. Also durable: credential possession on an account with no
     * assignment is rare and is exactly what a de-provisioning investigation
     * or a stale-credential probe looks like in hindsight. The actor id comes
     * from `verifyActor`, never from the form — the email typed into the login
     * form is never persisted as identity. `actor_class` stays `anonymous`,
     * matching the C2-4 line: the account holds NO surface class yet.
     */
    const correlationId = await currentCorrelationId();
    recordSecurityEvent({
      event: "auth.login.unassigned",
      correlationId,
      actorId: actor?.id,
      actorClass: "anonymous",
      outcome: "denied",
      metadata: { action: "auth.sign_in", stage: "surface_assignment" },
    });
    await recordSecurityAuditEvent({
      event: "auth.login.unassigned",
      correlationId,
      actorId: actor?.id ?? null,
      actorClass: "anonymous",
      actionSlug: "auth.sign_in",
      outcome: "denied",
      metadata: { stage: "surface_assignment" },
    });
    await supabase.auth.signOut();
    return signInUnassigned();
  }

  recordSecurityEvent({
    event: "auth.login.succeeded",
    correlationId: await currentCorrelationId(),
    actorId: actor?.id,
    actorClass: "client",
    outcome: "succeeded",
    metadata: { action: "auth.sign_in" },
  });

  redirect(safeAccountNextPath(formData.get("next")));
}

export async function signOutAction(): Promise<void> {
  if (await clientSupportRequested() || await clientSupportExitPending()) return endClientSupportAction();
  const supabase = await createNextServerSupabaseClient();

  /*
   * Read the actor BEFORE the session is destroyed, so the session-termination
   * event can be tied to an account — afterwards there is nobody to name.
   *
   * Guarded, and it must stay guarded: signing out is a safety action and must
   * succeed even when claim verification cannot. A failed read costs one field
   * on one log line; a thrown read would leave a user unable to log out.
   */
  const actorId = await supabase.auth
    .getClaims()
    .then(({ data }) => (typeof data?.claims?.sub === "string" ? data.claims.sub : null))
    .catch(() => null);

  if (clientPushAvailable(process.env)) {
    try {
      const rpc = supabase.rpc.bind(supabase) as unknown as (name: string) => PromiseLike<unknown>;
      await rpc("app_disable_my_push_session");
    } catch {
      // Session revocation remains the fallback if push cleanup is unavailable.
    }
  }
  await supabase.auth.signOut();

  recordSecurityEvent({
    event: "auth.logout",
    correlationId: await currentCorrelationId(),
    actorId,
    outcome: "succeeded",
    metadata: { action: "auth.sign_out" },
  });

  redirect("/login");
}
