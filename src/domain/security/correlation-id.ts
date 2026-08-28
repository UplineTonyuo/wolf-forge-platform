/**
 * The request correlation identifier. Pure: shape, generation and — most
 * importantly — validation of an untrusted inbound value.
 *
 * ## What it is for
 *
 * One user-visible failure normally spans a proxy hop, a server action, one or
 * more RPCs and possibly a provider call. Without a shared identifier those are
 * four unrelated log lines and an investigation is guesswork. With one they are
 * a trace.
 *
 * ## Where it comes from
 *
 * `src/proxy.ts` mints one per matched request and stamps it on the FORWARDED
 * REQUEST headers, so every server action, route handler and server component
 * on that request reads the same value through `next/headers`.
 *
 * ## Why the inbound value is never trusted
 *
 * The header is client-settable. Two things follow, and both are enforced:
 *
 *   1. The proxy OVERWRITES it unconditionally. It never adopts an inbound
 *      value, so a caller cannot pin every one of their requests to a single id
 *      to make a burst look like one request, nor reuse a victim's id to muddy
 *      an investigation.
 *   2. Readers still validate. 32 lowercase hex characters and nothing else, so
 *      even a bypassed proxy cannot get a newline, an ANSI escape or a 4 KB
 *      string into a log line. Log injection is the whole risk here: a raw
 *      header echoed into a JSON log can forge additional records.
 *
 * The id is random and carries no meaning. It is safe to show a user in a
 * support context because it says nothing about the failure — which is exactly
 * why it is a random token and not an encoded error state.
 */

/**
 * The forwarded request header. Prefixed rather than the conventional
 * `x-request-id` so it cannot be confused with, or silently overwritten by, a
 * platform header of the same name.
 */
export const CORRELATION_HEADER = "x-wolf-forge-request-id";

const CORRELATION_PATTERN = /^[0-9a-f]{32}$/;

export function isCorrelationId(value: unknown): value is string {
  return typeof value === "string" && CORRELATION_PATTERN.test(value);
}

/** Returns the value only when it is exactly the accepted shape; else null. */
export function normalizeCorrelationId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  return CORRELATION_PATTERN.test(candidate) ? candidate : null;
}

/**
 * Mints a new identifier from the platform CSPRNG.
 *
 * `globalThis.crypto` rather than `node:crypto` because this runs in the proxy
 * as well as in Node route handlers, and Web Crypto is the one API present in
 * both. `randomUUID()` is 122 bits of entropy; stripping the dashes gives the
 * 32-hex shape above with no loss.
 */
export function createCorrelationId(): string {
  return globalThis.crypto.randomUUID().replaceAll("-", "");
}
