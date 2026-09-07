import "server-only";

import { randomUUID } from "node:crypto";
import { unstable_cache } from "next/cache";

/**
 * The cheap signal an open Podcast Operations client polls every ~1s to
 * decide whether to refetch — an opaque, meaningless token, never a copy of
 * the sheet data itself. It lives in the same Next.js Data Cache as the
 * actual Sheets fetch, under its own tag, so `revalidateTag` from the sync
 * webhook can evict it independently: the poll only needs to know "this
 * changed", it never needs the Sheets round trip that computing the real
 * snapshot does.
 *
 * `revalidate: false` means this value is cached until explicitly evicted —
 * there is no time-based staleness here, only event-based.
 */
export const PODCAST_SYNC_VERSION_CACHE_TAG = "podcast-seo-sync-version";

const getCachedPodcastSyncVersion = unstable_cache(
  async () => randomUUID(),
  ["podcast-seo-sync-version"],
  { tags: [PODCAST_SYNC_VERSION_CACHE_TAG], revalidate: false },
);

export async function getPodcastSyncVersion(): Promise<string> {
  return getCachedPodcastSyncVersion();
}
