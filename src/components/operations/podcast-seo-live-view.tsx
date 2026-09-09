"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { PodcastOperationItem } from "../../domain/operations/podcast-workflow";
import type { PodcastMonthOption } from "../../lib/integrations/google-sheets-source";
import { PodcastSeoWorkflowView } from "./podcast-seo-workflow-view";
import { usePodcastLiveSync } from "./use-podcast-live-sync";

type Props = {
  initialItems: PodcastOperationItem[] | null;
  initialSourceMonth: string | null;
  initialLastSyncedAt: string | null;
  initialVaOptions: string[];
  monthOptions?: PodcastMonthOption[];
  selectedMonth?: string | null;
};

/**
 * The only things Operations V2/V3 add to the Podcast SEO page: near-realtime
 * invalidation and the month selector. `PodcastSeoWorkflowView` itself is
 * untouched in its filtering behavior — this wraps it rather than editing its
 * internals, so its search/status/VA/package filters and its detail drawer
 * keep working exactly as before. They are local `useState` inside that
 * component, never derived from these props, so a background snapshot update
 * (a new `items` array reference for the SAME month) re-renders the table
 * with fresh rows and status counts without resetting any filter the viewer
 * had set, and without unmounting the view — no flicker, no loading-screen
 * reset, no hard navigation. A month CHANGE is the one case
 * `PodcastSeoWorkflowView` itself resets filters for — see its own comment.
 */
export function PodcastSeoLiveView({
  initialItems,
  initialSourceMonth,
  initialLastSyncedAt,
  initialVaOptions,
  monthOptions = [],
  selectedMonth = null,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const snapshot = usePodcastLiveSync(
    {
      items: initialItems,
      sourceMonth: initialSourceMonth,
      lastSyncedAt: initialLastSyncedAt,
      vaOptions: initialVaOptions,
      monthOptions,
      selectedMonth,
    },
    selectedMonth,
  );

  /**
   * Updates the `?month=` URL state, which re-renders the server page with
   * the newly resolved snapshot/month-options/selectedMonth — the source of
   * truth `usePodcastLiveSync` above then adopts via its own render-phase
   * comparison, whether or not Next reuses this component instance across
   * the navigation. Every other query param the page might gain later is
   * preserved rather than being silently dropped.
   */
  function handleMonthChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <PodcastSeoWorkflowView
      items={snapshot.items}
      sourceMonth={snapshot.sourceMonth}
      lastSyncedAt={snapshot.lastSyncedAt}
      vaOptions={snapshot.vaOptions}
      monthOptions={snapshot.monthOptions}
      selectedMonth={snapshot.selectedMonth}
      onMonthChange={handleMonthChange}
    />
  );
}
