import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/i;

/** Hex-encoded HMAC-SHA256 over the exact raw request body bytes — never a re-serialized/reconstructed string, which could drift from what the caller actually signed. */
export function signOperationsWebhookPayload(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Constant-time signature check. Rejects outright (no comparison attempted)
 * when the provided value isn't even hex-SHA256-shaped, so malformed input
 * can never reach `timingSafeEqual` with mismatched buffer lengths.
 */
export function operationsWebhookSignatureMatches(
  rawBody: string,
  secret: string,
  providedSignatureHex: string | null,
): boolean {
  if (!providedSignatureHex || !HEX_SHA256_PATTERN.test(providedSignatureHex)) return false;
  const expected = Buffer.from(signOperationsWebhookPayload(rawBody, secret), "hex");
  const provided = Buffer.from(providedSignatureHex, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
