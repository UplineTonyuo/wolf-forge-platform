import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const GMAIL_OAUTH_STATE_COOKIE = "wf_gmail_oauth_state";
export const GMAIL_OAUTH_VERIFIER_COOKIE = "wf_gmail_oauth_verifier";

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function createOAuthState(): string {
  return base64Url(randomBytes(32));
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(64));
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function oauthStateMatches(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type GmailCallbackValidation =
  | { ok: true; code: string; verifier: string }
  | { ok: false; result: "state-error" | "provider-error" | "callback-error" };

export function validateGmailCallback(input: {
  expectedState: string | undefined;
  receivedState: string | null;
  verifier: string | undefined;
  code: string | null;
  providerError: boolean;
}): GmailCallbackValidation {
  if (!oauthStateMatches(input.expectedState, input.receivedState) || !input.verifier) {
    return { ok: false, result: "state-error" };
  }
  if (input.providerError) return { ok: false, result: "provider-error" };
  if (!input.code) return { ok: false, result: "callback-error" };
  return { ok: true, code: input.code, verifier: input.verifier };
}
