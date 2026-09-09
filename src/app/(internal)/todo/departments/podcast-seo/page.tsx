import type { Metadata } from "next";
import { loadPodcastWorkflowSnapshotBundleOrNull } from "../../../../../services/podcast-workflow-service";
import { PodcastSeoLiveView } from "../../../../../components/operations/podcast-seo-live-view";
import { getInternalContext } from "../../../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Operations — Podcast SEO" };

/**
 * Read-only, with near-realtime invalidation (Operations V2) and a month
 * selector (Operations V3). This still fetches once per request on the
 * initial load — Next's own `fetch` cache inside
 * `GoogleSheetsPodcastWorkflowSource` revalidates every 5 minutes, see
 * `next: { revalidate: 300, tags: [...] }` there — but an already-open tab no
 * longer waits for that cadence or a manual refresh: `PodcastSeoLiveView`
 * polls a cheap version signal and refetches through
 * `/api/operations/podcast-seo/snapshot` when the Podcast SEO sync webhook
 * (`/api/operations/podcast-seo/sync`) invalidates it. The browser is never
 * given a Supabase token or any other credential to do this — see that
 * route and `use-podcast-live-sync.ts`. `getInternalContext()` is called
 * only to confirm this remains an authenticated internal request — the same
 * gate every other Operations/To Do route already relies on.
 *
 * `month` is untrusted input straight from the URL. It is never used to
 * build a Sheets range or tab name directly — `loadPodcastWorkflowSnapshotBundleOrNull`
 * resolves it through `PodcastWorkflowService.getSnapshotForMonth`, which
 * only ever accepts one of the tab titles the source itself just discovered
 * (`listAvailablePodcastMonths`), falling back to the newest month for
 * anything else.
 */
export default async function PodcastSeoPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await getInternalContext();

  const { month } = await searchParams;
  const bundle = await loadPodcastWorkflowSnapshotBundleOrNull(month ?? null);
  return (
    <PodcastSeoLiveView
      initialItems={bundle?.snapshot.items ?? null}
      initialSourceMonth={bundle?.snapshot.sourceMonth ?? null}
      initialLastSyncedAt={bundle?.snapshot.lastSyncedAt ?? null}
      initialVaOptions={bundle?.snapshot.vaOptions ?? []}
      monthOptions={bundle?.monthOptions ?? []}
      selectedMonth={bundle?.selectedMonth ?? null}
    />
  );
}
