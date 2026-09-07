import "server-only";

/**
 * In-memory replay/debounce guard for the Podcast SEO sync webhook.
 *
 * Runs only AFTER the caller has already proven the HMAC signature, so this
 * is not an authentication control — it exists purely to keep a burst of
 * authenticated notifications (a Sheet edit that touches many cells, an Apps
 * Script retry, an exact replay of a previous call) from re-running the
 * actual cache invalidation more often than necessary. Best-effort and
 * per-instance: Vercel may route requests to more than one warm instance, so
 * this does not guarantee a single global count. That is an acceptable
 * trade-off here because the only thing a bypass buys an attacker who
 * already knows the shared secret is an extra harmless Google Sheets
 * refetch, not a data or authorization compromise.
 */

const NONCE_TTL_MS = 5 * 60 * 1000;
const MIN_EFFECT_INTERVAL_MS = 500;
const MAX_TRACKED_NONCES = 500;

type GuardState = {
  seenNonces: Map<string, number>;
  lastEffectAt: number;
};

let state: GuardState = { seenNonces: new Map(), lastEffectAt: 0 };

function pruneExpired(nowMs: number): void {
  for (const [nonce, expiresAt] of state.seenNonces) {
    if (expiresAt <= nowMs) state.seenNonces.delete(nonce);
  }
  const excess = state.seenNonces.size - MAX_TRACKED_NONCES;
  if (excess > 0) {
    let removed = 0;
    for (const key of state.seenNonces.keys()) {
      if (removed >= excess) break;
      state.seenNonces.delete(key);
      removed += 1;
    }
  }
}

/**
 * Returns whether THIS call should actually trigger the cache invalidation.
 * An exact nonce replay, or any call arriving within `MIN_EFFECT_INTERVAL_MS`
 * of the last one that did trigger it, coalesces into the existing effect —
 * multiple rapid Sheet cell edits collapse into one refetch.
 */
export function shouldTriggerPodcastSyncEffect(nonce: string, nowMs: number): boolean {
  pruneExpired(nowMs);

  if (state.seenNonces.has(nonce)) return false;
  state.seenNonces.set(nonce, nowMs + NONCE_TTL_MS);

  if (nowMs - state.lastEffectAt < MIN_EFFECT_INTERVAL_MS) return false;
  state.lastEffectAt = nowMs;
  return true;
}

/** Test-only: clears in-memory guard state between test cases. */
export function resetPodcastSyncGuardForTests(): void {
  state = { seenNonces: new Map(), lastEffectAt: 0 };
}
