/**
 * The bot-challenge capability shape, and the one question about it that can be
 * answered without touching a provider: is one configured at all?
 *
 * Pure and importable anywhere. The server adapter that would actually talk to
 * a provider lives in `lib/security/bot-verification-gateway.ts`, which is
 * `server-only`, and the enforcement half lives in the database — see
 * `private.require_bot_verification` in
 * `20260821130000_b2_abuse_resistance_hardening.sql`.
 *
 * Two independent switches have to be on before a real challenge works end to
 * end, and they answer different questions:
 *
 *   this module            can the application satisfy a challenge?
 *                          (provider credentials exist in the environment)
 *   the database registry  is a challenge required?
 *                          (an enabled row with enforce_public_forms)
 *
 * Neither is currently on. `app_submit_form` therefore records
 * `not_configured` and anonymous public Forms keep working, held only by the
 * database throttles — which is the honest state, not a silent pass.
 */

/** Every challenge receipt is scoped to one operation and one subject. */
export type BotVerificationScope = "form.submit";

export type BotVerificationRequest = {
  scope: BotVerificationScope;
  /** The subject the receipt is bound to — for `form.submit`, the Form id. */
  subject: string;
  /** The opaque token the provider's widget produced in the browser. */
  token: string;
};

export type BotVerificationResult =
  | { verified: true }
  | { verified: false; reason: string };

/**
 * The provider capability the platform will need, and nothing more.
 *
 * One operation, because the intended flow has exactly one server-side step
 * that touches the provider. No scoring thresholds, no analytics and no
 * enterprise risk signals: none has a caller, and an unused method on a port is
 * a decision made early with no information.
 */
export type BotVerificationGateway = {
  verify(request: BotVerificationRequest): Promise<BotVerificationResult>;
};

/**
 * True when a bot-verification provider is configured for this environment.
 *
 * Reads the environment rather than the database on purpose: this is the
 * application's half of the answer. Both keys must be present and non-blank —
 * a provider name with no secret cannot verify anything, and claiming it could
 * is exactly the kind of half-configured state that turns a security control
 * into decoration.
 */
export function isBotVerificationConfigured(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return (
    typeof source.BOT_VERIFICATION_PROVIDER === "string" &&
    source.BOT_VERIFICATION_PROVIDER.trim() !== "" &&
    typeof source.BOT_VERIFICATION_SECRET_KEY === "string" &&
    source.BOT_VERIFICATION_SECRET_KEY.trim() !== ""
  );
}
