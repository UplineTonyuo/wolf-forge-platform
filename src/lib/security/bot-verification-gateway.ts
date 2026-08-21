import "server-only";

import type { BotVerificationGateway } from "../../domain/security/bot-verification";
import { ApplicationError } from "../errors/application-error";

/**
 * Where a bot-challenge provider will plug in. Nothing here calls one.
 *
 * This file is a seam, not an integration. There is no provider SDK, no HTTP
 * client, no credential read and no network call anywhere in it, and
 * `createBotVerificationGateway()` throws rather than pretending — the same
 * decision `createPayPalGateway()` makes. A stub that silently returned
 * "verified" would be worse than no challenge at all, because every surface
 * downstream would believe a human had been proved.
 *
 * The port shape lives in `domain/security/bot-verification.ts`, so the pure
 * half is importable and testable and only the vendor adapter is server-only.
 *
 * THE DATABASE HALF ALREADY EXISTS, in
 * `20260821130000_b2_abuse_resistance_hardening.sql`:
 *
 *   private.bot_verification_providers   registry, empty by default
 *   private.bot_verifications            single-use receipts
 *   private.record_bot_verification()    trusted-server write
 *   private.require_bot_verification()   consumed by public.app_submit_form
 *
 * `public.app_submit_form` accepts `context.bot_token` and, for a PUBLIC Form,
 * calls `private.require_bot_verification('form.submit', <form id>, token)`.
 * While the registry holds no enabled + enforcing provider that call returns
 * `not_configured` and the submission proceeds, so anonymous public Forms keep
 * working. The moment a provider is registered and enabled it fails closed.
 *
 * THE INTENDED FLOW, for whoever implements it:
 *
 *   1. the public Form page renders the provider's widget with its SITE key
 *   2. the browser solves the challenge and gets a provider token
 *   3. the browser sends that token to a Wolf Forge SERVER route
 *   4. the server verifies the token against the provider with its SECRET key
 *   5. on success the server calls `private.record_bot_verification(...)`,
 *      which needs the trusted server Supabase client (`SUPABASE_SECRET_KEY`,
 *      not currently present in `.env.local`)
 *   6. the browser submits the Form with the same token in `context.bot_token`
 *   7. `app_submit_form` consumes the single-use receipt
 *
 * WHAT THE IMPLEMENTATION MUST NOT DO, written down before anyone starts:
 *
 *   - never verify the provider token in the browser, and never let the secret
 *     key reach a client bundle; only the site key may ever appear there
 *   - never let the database make the outbound verification call; the receipt
 *     is written by a trusted server that already knows the answer
 *   - never accept the provider's own response as the receipt; the receipt is
 *     scoped to `('form.submit', form id)` and is single use, so a token
 *     verified for one Form cannot be replayed against another
 *   - never treat a challenge as a replacement for the throttles; the limits in
 *     `private.consume_rate_limit` remain the enforced ceiling either way
 */

/**
 * There is no bot-verification gateway yet.
 *
 * Throws with a client-safe message and no configuration detail. Unreachable in
 * practice — no surface offers a challenge while `isBotVerificationConfigured()`
 * is false — so reaching this is a programming error, and it fails loudly
 * instead of quietly returning a fake verification.
 */
export function createBotVerificationGateway(): BotVerificationGateway {
  throw new ApplicationError(
    "VALIDATION_ERROR",
    "Bot verification is not connected to Wolf Forge yet.",
  );
}
