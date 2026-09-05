/**
 * Podcast SEO change-notification webhook — pure half.
 *
 * This module never performs I/O, never touches `node:crypto`, and never
 * reads a header or an env var. It only decides two things: does this
 * payload have the right SHAPE, and is this TIMESTAMP fresh enough to trust.
 * Signature verification (which needs the shared secret and constant-time
 * comparison) lives in `lib/security/operations-webhook-hmac.ts`; keeping the
 * two apart means the shape/freshness rules are testable with no crypto and
 * no server context at all.
 *
 * The payload is intentionally the smallest possible "something changed"
 * signal — Apps Script never sends client names, emails, credentials, login
 * values, sheet row contents, podcast URLs, notes, or any other workflow
 * data. Google Sheets stays canonical: this tells Wolf Forge only to go
 * re-read it, never what changed.
 */

import { z } from "zod";

/** The only event this webhook currently accepts. A literal, not a free string, so an unrelated payload cannot slip through as "some future event". */
export const PODCAST_SYNC_EVENT_TYPE = "podcast_seo_changed" as const;

/**
 * Loose shape check, independent of the event-type allowlist. Kept separate
 * from `PODCAST_SYNC_EVENT_TYPE` so a malformed payload (wrong field types,
 * missing fields) and an irrelevant-but-well-formed one (a different,
 * unrecognized event type) can be told apart and logged as distinct
 * rejection reasons.
 */
export const podcastSyncWebhookShapeSchema = z.object({
  eventType: z.string().trim().min(1).max(64),
  /** Unix milliseconds. Apps Script sends `Date.now()`. */
  timestamp: z.number().int().positive(),
  /** Opaque replay/dedupe token, not a secret — any short unique string. */
  nonce: z.string().trim().min(8).max(128),
});

export type PodcastSyncWebhookShape = z.infer<typeof podcastSyncWebhookShapeSchema>;

export type PodcastSyncWebhookPayload = {
  eventType: typeof PODCAST_SYNC_EVENT_TYPE;
  timestamp: number;
  nonce: string;
};

export function isRecognizedPodcastSyncEventType(
  eventType: string,
): eventType is typeof PODCAST_SYNC_EVENT_TYPE {
  return eventType === PODCAST_SYNC_EVENT_TYPE;
}

/** How far in the past a timestamp may be and still be trusted. */
export const PODCAST_SYNC_MAX_AGE_MS = 5 * 60 * 1000;
/** How far in the future, to absorb ordinary clock skew without accepting a pre-minted future token. */
export const PODCAST_SYNC_MAX_FUTURE_SKEW_MS = 30 * 1000;

export function isPodcastSyncTimestampFresh(
  timestampMs: number,
  nowMs: number,
  options: { maxAgeMs?: number; maxFutureSkewMs?: number } = {},
): boolean {
  const maxAgeMs = options.maxAgeMs ?? PODCAST_SYNC_MAX_AGE_MS;
  const maxFutureSkewMs = options.maxFutureSkewMs ?? PODCAST_SYNC_MAX_FUTURE_SKEW_MS;
  const ageMs = nowMs - timestampMs;
  if (ageMs > maxAgeMs) return false;
  if (ageMs < -maxFutureSkewMs) return false;
  return true;
}

/**
 * Only tabs meant for this workflow should ever wake the webhook. Mirrors
 * `tabTitlePrefix` in `GoogleSheetsPodcastWorkflowSource` — Apps Script
 * applies the same rule client-side before it ever calls out, and the server
 * never trusts the sheet name Apps Script claims triggered it anyway (the
 * webhook payload carries no sheet name at all), so this exists purely so the
 * two independent implementations of "is this a Podcast tab" agree.
 */
export const PODCAST_TAB_TITLE_PREFIX = "PODCAST";

export function isPodcastWorkflowTabName(sheetName: string): boolean {
  return sheetName.trim().toUpperCase().startsWith(PODCAST_TAB_TITLE_PREFIX);
}
