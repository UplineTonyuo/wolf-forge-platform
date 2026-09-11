"use client";

import { useEffect, useRef, useState } from "react";
import type { PodcastOperationItem } from "../../domain/operations/podcast-workflow";
import type { PodcastMonthOption } from "../../lib/integrations/google-sheets-source";

export type PodcastWorkflowSnapshotState = {
  items: PodcastOperationItem[] | null;
  sourceMonth: string | null;
  lastSyncedAt: string | null;
  /** The Assigned VA filter's full option list — see `mergeAssignedVaOptions`. Refreshed on every refetch same as `items`. */
  vaOptions: string[];
  /** The month selector's server-discovered allowlist, newest first. */
  monthOptions: PodcastMonthOption[];
  /** The resolved "YYYY-MM" actually in view — `null` only when the workbook has no dated tab at all. */
  selectedMonth: string | null;
};

/** How often an open, visible tab checks the cheap version signal. */
const POLL_MS = 1_200;
/** Collapses a burst of rapid Sheet edits into one refetch. */
const DEBOUNCE_MS = 700;

/**
 * Operations V2 near-realtime invalidation, client half — now month-aware
 * (Operations V3).
 *
 * NOT a push channel and NOT Supabase Realtime — this codebase deliberately
 * keeps every Supabase-authenticated boundary server-side (see the doc
 * comment on `TeamMessagesDrawer`: the team tables force RLS with no
 * policies, so a client-side realtime subscription would mean handing the
 * browser a Supabase token). This follows that same shape instead: a short,
 * authenticated, same-origin poll of a cheap version signal
 * (`/api/operations/podcast-seo/version`), and — only when that value
 * actually changes — one debounced refetch of the real data
 * (`/api/operations/podcast-seo/snapshot`). The browser never receives a
 * Supabase token, a service-account credential, or anything else it could
 * use to reach Google Sheets or the database directly.
 *
 * Deliberately NOT a copy of `useTeamSyncController` — that scheduler's
 * FAST/WARM/QUIET tiers and per-lane backoff exist for a much higher-traffic
 * surface (every signed-in employee, all day). This is one fixed cadence
 * behind one visibility check, sized for what this feature actually needs.
 *
 * Pausing while the tab is hidden and reconciling on return mirrors that
 * same established pattern. The returned state only ever changes via
 * `setState` on a real response, so a transient poll or refetch failure
 * simply leaves the last known good snapshot on screen until the next tick
 * retries — it never blanks the view or shows a loading state again after
 * the first successful load.
 *
 * `month` is the currently selected "YYYY-MM" (or `null` for "no dated tab
 * exists"), owned by the parent via the page's own `?month=` URL state. Two
 * things track it: `monthRef`, kept current after every render so the
 * in-flight poll/refetch loop (mounted once, empty-deps `useEffect`) always
 * targets the *latest* selection rather than whatever `month` was at mount
 * time; and a render-phase comparison against `initial.selectedMonth` that
 * immediately adopts fresh server-rendered data the moment a month change
 * actually lands, the same synchronous-setState-during-render pattern
 * `DepartmentRecordInspector` already uses to adopt a changed prop — this
 * is what keeps rows, status counts, VA/package filters, search, and
 * output/resource data all correct immediately after a month switch even if
 * the surrounding client component tree is never unmounted by the
 * navigation.
 */
export function usePodcastLiveSync(
  initial: PodcastWorkflowSnapshotState,
  month: string | null,
): PodcastWorkflowSnapshotState {
  const [snapshot, setSnapshot] = useState(initial);
  const versionRef = useRef<string | null>(null);
  const snapshotInFlightRef = useRef(false);
  const monthRef = useRef(month);

  useEffect(() => {
    monthRef.current = month;
  });

  if (initial.selectedMonth !== snapshot.selectedMonth) {
    setSnapshot(initial);
  }

  useEffect(() => {
    let disposed = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    async function refetchSnapshot() {
      if (snapshotInFlightRef.current) return;
      snapshotInFlightRef.current = true;
      try {
        const query = monthRef.current ? `?month=${encodeURIComponent(monthRef.current)}` : "";
        const response = await fetch(`/api/operations/podcast-seo/snapshot${query}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const body: unknown = await response.json();
        if (
          disposed ||
          typeof body !== "object" ||
          body === null ||
          !("ok" in body) ||
          (body as { ok: unknown }).ok !== true
        ) {
          return;
        }
        const data = (body as unknown as { data: PodcastWorkflowSnapshotState | null }).data;
        setSnapshot(
          data
            ? {
                items: data.items,
                sourceMonth: data.sourceMonth,
                lastSyncedAt: data.lastSyncedAt,
                vaOptions: data.vaOptions ?? [],
                monthOptions: data.monthOptions ?? [],
                selectedMonth: data.selectedMonth ?? null,
              }
            : {
                items: null,
                sourceMonth: null,
                lastSyncedAt: null,
                vaOptions: [],
                monthOptions: [],
                selectedMonth: null,
              },
        );
      } catch {
        /* Transient — the next poll tick will see the version is still new and try again. */
      } finally {
        snapshotInFlightRef.current = false;
      }
    }

    function scheduleRefetch() {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void refetchSnapshot();
      }, DEBOUNCE_MS);
    }

    async function pollVersion() {
      try {
        const response = await fetch("/api/operations/podcast-seo/version", { cache: "no-store" });
        if (!response.ok) return;
        const body: unknown = await response.json();
        const nextVersion =
          typeof body === "object" && body !== null && typeof (body as { version?: unknown }).version === "string"
            ? (body as { version: string }).version
            : null;
        if (!nextVersion) return;
        if (versionRef.current !== null && nextVersion !== versionRef.current) {
          scheduleRefetch();
        }
        versionRef.current = nextVersion;
      } catch {
        /* Transient — retried on the next tick. */
      }
    }

    function scheduleNextPoll() {
      if (pollTimer !== null) clearTimeout(pollTimer);
      pollTimer = setTimeout(tick, POLL_MS);
    }

    function tick() {
      if (disposed) return;
      void pollVersion().finally(scheduleNextPoll);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        if (pollTimer === null) tick();
      } else if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    }

    if (document.visibilityState === "visible") tick();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (pollTimer !== null) clearTimeout(pollTimer);
      if (debounceTimer !== null) clearTimeout(debounceTimer);
    };
  }, []);

  return snapshot;
}
