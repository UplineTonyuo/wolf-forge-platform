"use client";

import type { PodcastOperationItem } from "../../domain/operations/podcast-workflow";
import { PodcastSeoWorkflowView } from "./podcast-seo-workflow-view";
import { usePodcastLiveSync } from "./use-podcast-live-sync";

type Props = {
  initialItems: PodcastOperationItem[] | null;
  initialSourceMonth: string | null;
  initialLastSyncedAt: string | null;
  initialVaOptions: string[];
};

/**
 * The only thing Operations V2 adds to the Podcast SEO page: near-realtime
 * invalidation. `PodcastSeoWorkflowView` itself is untouched — this wraps it
 * rather than editing it, so its search/status/VA/package filters and its
 * detail drawer keep working exactly as before. They are local `useState`
 * inside that component, never derived from these props, so a background
 * snapshot update (a new `items` array reference) re-renders the table with
 * fresh rows and status counts without resetting any filter the viewer had
 * set, and without unmounting the view — no flicker, no loading-screen
 * reset, no hard navigation.
 */
export function PodcastSeoLiveView({
  initialItems,
  initialSourceMonth,
  initialLastSyncedAt,
  initialVaOptions,
}: Props) {
  const snapshot = usePodcastLiveSync({
    items: initialItems,
    sourceMonth: initialSourceMonth,
    lastSyncedAt: initialLastSyncedAt,
    vaOptions: initialVaOptions,
  });

  return (
    <PodcastSeoWorkflowView
      items={snapshot.items}
      sourceMonth={snapshot.sourceMonth}
      lastSyncedAt={snapshot.lastSyncedAt}
      vaOptions={snapshot.vaOptions}
    />
  );
}
