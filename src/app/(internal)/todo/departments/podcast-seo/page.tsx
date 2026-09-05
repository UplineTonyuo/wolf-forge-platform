import type { Metadata } from "next";
import { loadPodcastWorkflowSnapshotOrNull } from "../../../../../services/podcast-workflow-service";
import { PodcastSeoLiveView } from "../../../../../components/operations/podcast-seo-live-view";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Operations — Podcast SEO" };

/**
 * Read-only, with near-realtime invalidation (Operations V2). This still
 * fetches once per request on the initial load — Next's own `fetch` cache
 * inside `GoogleSheetsPodcastWorkflowSource` revalidates every 5 minutes, see
 * `next: { revalidate: 300, tags: [...] }` there — but an already-open tab no
 * longer waits for that cadence or a manual refresh: `PodcastSeoLiveView`
 * polls a cheap version signal and refetches through
 * `/api/operations/podcast-seo/snapshot` when the Podcast SEO sync webhook
 * (`/api/operations/podcast-seo/sync`) invalidates it. The browser is never
 * given a Supabase token or any other credential to do this — see that
 * route and `use-podcast-live-sync.ts`. `getInternalContext()` is called
 * only to confirm this remains an authenticated internal request — the same
 * gate every other Operations/To Do route already relies on.
 */
export default async function PodcastSeoPage() {
  await getInternalContext();

  const snapshot = await loadPodcastWorkflowSnapshotOrNull();
  return (
    <PodcastSeoLiveView
      initialItems={snapshot?.items ?? null}
      initialSourceMonth={snapshot?.sourceMonth ?? null}
      initialLastSyncedAt={snapshot?.lastSyncedAt ?? null}
      initialVaOptions={snapshot?.vaOptions ?? []}
    />
  );
}
