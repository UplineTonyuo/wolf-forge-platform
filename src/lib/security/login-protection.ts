import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { checkBotId } from "botid/server";
import { headers } from "next/headers";
import { readServerEnvironment } from "../env/server-env";
import { mapDatabaseError } from "../errors/map-database-error";
import { createTrustedServerSupabaseClient } from "../supabase/trusted-server-client";

export type LoginProtectionContext = {
  forwardedIp: string | null;
  sourceFingerprint: string;
  identityFingerprint: string;
  identityTargeted: boolean;
};

export type LoginProtectionResult =
  | { ok: true; context: LoginProtectionContext | null }
  | {
      ok: false;
      reason: "bot" | "bot_check_failed" | "source_unavailable" | "limiter_unavailable";
    };

/**
 * Normalize only for a privacy-preserving limiter subject. This value is never
 * used to decide whether an account exists and never leaves this process in
 * plaintext.
 */
export function normalizeLoginIdentity(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US").slice(0, 320);
}

/**
 * Vercel overwrites x-vercel-forwarded-for at its edge. We trust that one
 * platform header only while actually running on Vercel; an arbitrary header
 * supplied to a local or self-hosted process is not an identity signal.
 */
export function trustedLoginSource(
  requestHeaders: Pick<Headers, "get">,
  environment: Record<string, string | undefined> = process.env,
): string | null {
  if (environment.VERCEL !== "1") return "127.0.0.1";

  const raw = requestHeaders.get("x-vercel-forwarded-for")?.trim() ?? "";
  if (!raw || raw.includes(",") || isIP(raw) === 0) return null;
  return raw;
}

export function loginFingerprint(secret: string, kind: "source" | "identity", value: string): string {
  return createHmac("sha256", secret)
    .update(`wolf-forge-login:${kind}:v1\0${value}`, "utf8")
    .digest("hex");
}

function identityTargetedFrom(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      "identity_targeted" in value &&
      (value as { identity_targeted?: unknown }).identity_targeted === true,
  );
}

/**
 * Protects the expensive Auth call in this order:
 *
 *   invisible BotID Basic -> trusted source -> durable multi-signal limiter.
 *
 * BotID and the limiter both fail closed in production. Local development is
 * allowed to proceed without a service key because BotID itself explicitly
 * reports human in development and the local stack is not an internet-facing
 * production boundary.
 */
export async function beginProtectedLogin(email: string): Promise<LoginProtectionResult> {
  try {
    const bot = await checkBotId();
    if (bot.isBot) return { ok: false, reason: "bot" };
  } catch {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, reason: "bot_check_failed" };
    }
  }

  let environment;
  try {
    environment = readServerEnvironment();
  } catch {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, reason: "limiter_unavailable" };
    }
    return { ok: true, context: null };
  }

  const forwardedIp = trustedLoginSource(await headers());
  if (!forwardedIp) return { ok: false, reason: "source_unavailable" };

  const sourceFingerprint = loginFingerprint(
    environment.SUPABASE_SECRET_KEY,
    "source",
    forwardedIp,
  );
  const identityFingerprint = loginFingerprint(
    environment.SUPABASE_SECRET_KEY,
    "identity",
    normalizeLoginIdentity(email),
  );
  const trusted = createTrustedServerSupabaseClient(environment);
  const { data, error } = await trusted.rpc("app_login_rate_limit_preflight", {
    p_source_fingerprint: sourceFingerprint,
    p_identity_fingerprint: identityFingerprint,
  });

  if (error) {
    const mapped = mapDatabaseError(error, "Login attempt");
    if (mapped.code === "RATE_LIMITED") throw mapped;
    return { ok: false, reason: "limiter_unavailable" };
  }

  return {
    ok: true,
    context: {
      forwardedIp,
      sourceFingerprint,
      identityFingerprint,
      identityTargeted: identityTargetedFrom(data),
    },
  };
}

export async function recordProtectedLoginFailure(
  context: LoginProtectionContext | null,
): Promise<void> {
  if (!context) return;
  const trusted = createTrustedServerSupabaseClient(readServerEnvironment());
  const { error } = await trusted.rpc("app_record_login_failure", {
    p_source_fingerprint: context.sourceFingerprint,
    p_identity_fingerprint: context.identityFingerprint,
  });
  if (error) throw mapDatabaseError(error, "Login attempt");
}

/** A successful credential proof clears only this source+identity cooldown. */
export async function clearProtectedLoginPairFailures(
  context: LoginProtectionContext | null,
): Promise<void> {
  if (!context) return;
  const trusted = createTrustedServerSupabaseClient(readServerEnvironment());
  const { error } = await trusted.rpc("app_clear_login_pair_failures", {
    p_source_fingerprint: context.sourceFingerprint,
    p_identity_fingerprint: context.identityFingerprint,
  });
  if (error) throw mapDatabaseError(error, "Login attempt");
}

