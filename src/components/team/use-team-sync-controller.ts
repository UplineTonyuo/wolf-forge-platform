"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  TEAM_BACKGROUND_CLOSED_MS,
  TEAM_BACKGROUND_OPEN_MS,
  TEAM_BACKGROUND_QUIET_MS,
  TEAM_LIVE_CLOSED_MS,
  TEAM_LIVE_FAST_MS,
  TEAM_LIVE_QUIET_MS,
  TEAM_LIVE_WARM_MS,
  computeTeamBackgroundDelayMs,
  computeTeamLiveDelayMs,
  nextTeamLiveTier,
  type TeamLiveTier,
} from "../../domain/team/live-scheduler";

export {
  TEAM_BACKGROUND_CLOSED_MS,
  TEAM_BACKGROUND_OPEN_MS,
  TEAM_BACKGROUND_QUIET_MS,
  TEAM_LIVE_CLOSED_MS,
  TEAM_LIVE_FAST_MS,
  TEAM_LIVE_QUIET_MS,
  TEAM_LIVE_WARM_MS,
};

/** How often a materialized-digest sweep is allowed, unchanged since V2.2. */
const TEAM_DIGEST_SYNC_MS = 60_000;

type TeamSyncControllerOptions = {
  active: boolean;
  /**
   * The CLOSED/OPEN cadence axis: whether a Team conversation is the visible
   * surface right now. False whenever the drawer is closed, and also while
   * the drawer shows the Tickets pane, whose own Ticket polling covers that
   * view — the lanes then take TEAM_LIVE_CLOSED_MS / TEAM_BACKGROUND_CLOSED_MS.
   */
  open: boolean;
  /** Changing this forces an immediate wake: conversation switch, pane change, task-scope change. */
  syncKey: string;
  /**
   * The live lane. `ok: false` (a rejected request, not a thrown exception —
   * `fetchTeamLive` already turns network/HTTP failures into a result
   * object) feeds the backoff counter. `changed` says whether the response
   * carried a meaningful update (new/updated message, reaction, tombstone,
   * typing state), so the scheduler knows to stay/return to FAST. A response
   * the caller judged stale (e.g. answered a conversation the viewer already
   * left) should report `changed: false` regardless of what the payload
   * contained — the hook trusts that judgment rather than re-deriving it.
   */
  syncLive: () => Promise<{ ok: boolean; changed: boolean }>;
  syncBackground: (options: { materializeDigests: boolean }) => Promise<{ ok: boolean }>;
};

/**
 * V2.5 adaptive scheduler.
 *
 * V2.2-V2.4 drove both lanes on a fixed open/closed cadence via
 * `setInterval`. `TeamMessagesDrawer` mounts for the whole session
 * regardless of whether Team is ever opened, so the CLOSED cadence (700ms
 * live -> was 1.2s, now 15s) ran all day for every signed-in employee — this
 * is what produced the Vercel invocation/duration spike V2.5 exists to fix.
 *
 * This version adds, without touching the two-lane split, the security
 * boundary, or any V2.1-V2.4 product behavior:
 *
 * - three open-conversation tiers (FAST/WARM/QUIET) that decay from local or
 *   remote activity rather than staying pinned to one interval forever;
 * - a CLOSED cadence of 60s, with immediate reconciliation on return;
 * - explicit HIDDEN/OFFLINE pausing (no timer runs at all while
 *   `document.visibilityState !== "visible"` or `!navigator.onLine`), with
 *   immediate reconciliation on return;
 * - bounded exponential backoff per lane on transient/auth failures, so a
 *   failing or expired session cannot hot-loop;
 * - small jitter on every SCHEDULED (non-immediate) tick, to keep many
 *   employees opening the app around the same moment from synchronizing
 *   their poll clocks;
 * - recursive `setTimeout` instead of `setInterval`, so there is
 *   structurally never more than one live and one background request
 *   in flight, and the interval used for the NEXT tick is always freshly
 *   computed rather than fixed at mount.
 *
 * All policy (which tier, which delay, whether a delta counts as activity)
 * is pure and lives in `src/domain/team/live-scheduler.ts`; this hook only
 * owns the real timers and browser event listeners.
 */
export function useTeamSyncController({
  active,
  open,
  syncKey,
  syncLive,
  syncBackground,
}: TeamSyncControllerOptions) {
  const liveRef = useRef(syncLive);
  const backgroundRef = useRef(syncBackground);
  useEffect(() => {
    liveRef.current = syncLive;
    backgroundRef.current = syncBackground;
  }, [syncBackground, syncLive]);

  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  /*
   * Mutable scheduler state. Deliberately NOT React state: it changes on
   * every tick, and none of it should ever trigger a re-render or re-run an
   * effect — only real Team data changes do that.
   */
  const scheduleState = useRef({
    tier: "fast" as TeamLiveTier,
    /*
     * A placeholder, not a real timestamp — reading `Date.now()` during
     * render would be an impure render (react-hooks/purity). The mount
     * effect's first `wake()` call always sets the real value via
     * `markActivity()` before anything ever reads it.
     */
    lastActivityAt: 0,
    liveFailures: 0,
    backgroundFailures: 0,
    lastDigestAt: 0,
  });

  const liveInFlight = useRef(false);
  const backgroundInFlight = useRef(false);
  const pendingLiveWake = useRef(false);
  const pendingBackgroundWake = useRef(false);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backgroundTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposed = useRef(false);

  /* Stable call targets `refreshNow` (below) and the syncKey effect can reach without depending on the mount effect's internals. */
  const wakeRef = useRef<() => void>(() => {});
  const refreshNowRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    disposed.current = false;
    if (!active) return;

    const suspended = () =>
      document.visibilityState !== "visible" || !navigator.onLine;

    const clearLiveTimer = () => {
      if (liveTimer.current !== null) {
        clearTimeout(liveTimer.current);
        liveTimer.current = null;
      }
    };
    const clearBackgroundTimer = () => {
      if (backgroundTimer.current !== null) {
        clearTimeout(backgroundTimer.current);
        backgroundTimer.current = null;
      }
    };

    const markActivity = () => {
      scheduleState.current.lastActivityAt = Date.now();
      scheduleState.current.tier = "fast";
    };

    const scheduleLive = (immediate: boolean) => {
      clearLiveTimer();
      if (disposed.current || suspended()) return;
      const idleMs = Date.now() - scheduleState.current.lastActivityAt;
      scheduleState.current.tier = nextTeamLiveTier(idleMs);
      const delay = immediate
        ? 0
        : computeTeamLiveDelayMs({
            open: openRef.current,
            tier: scheduleState.current.tier,
            failureCount: scheduleState.current.liveFailures,
          });
      liveTimer.current = setTimeout(() => {
        void runLive();
      }, delay);
    };

    const scheduleBackground = (immediate: boolean) => {
      clearBackgroundTimer();
      if (disposed.current || suspended()) return;
      const delay = immediate
        ? 0
        : computeTeamBackgroundDelayMs({
            open: openRef.current,
            tier: scheduleState.current.tier,
            failureCount: scheduleState.current.backgroundFailures,
          });
      backgroundTimer.current = setTimeout(() => {
        void runBackground();
      }, delay);
    };

    async function runLive() {
      if (disposed.current || suspended() || liveInFlight.current) return;
      liveInFlight.current = true;
      let changed = false;
      try {
        const result = await liveRef.current();
        scheduleState.current.liveFailures = result.ok ? 0 : scheduleState.current.liveFailures + 1;
        changed = result.ok && result.changed;
      } catch {
        /* An unexpected exception (a bug, an aborted fetch) is a failure too. */
        scheduleState.current.liveFailures += 1;
      } finally {
        liveInFlight.current = false;
      }
      if (changed) markActivity();
      const immediate = pendingLiveWake.current;
      pendingLiveWake.current = false;
      scheduleLive(immediate);
    }

    async function runBackground() {
      if (disposed.current || suspended() || backgroundInFlight.current) return;
      backgroundInFlight.current = true;
      const materializeDigests =
        Date.now() - scheduleState.current.lastDigestAt >= TEAM_DIGEST_SYNC_MS;
      try {
        const result = await backgroundRef.current({ materializeDigests });
        scheduleState.current.backgroundFailures = result.ok ? 0 : scheduleState.current.backgroundFailures + 1;
        if (result.ok && materializeDigests) scheduleState.current.lastDigestAt = Date.now();
      } catch {
        scheduleState.current.backgroundFailures += 1;
      } finally {
        backgroundInFlight.current = false;
      }
      const immediate = pendingBackgroundWake.current;
      pendingBackgroundWake.current = false;
      scheduleBackground(immediate);
    }

    /**
     * Cancel/skip whatever is scheduled and reconcile right now. If a lane
     * is already mid-request, its own completion is asked to immediately
     * reschedule (rather than waiting the normal computed delay) instead of
     * starting a second, overlapping request for the same lane.
     */
    function reconcile(): { live: Promise<void>; background: Promise<void> } {
      markActivity();
      if (suspended()) return { live: Promise.resolve(), background: Promise.resolve() };

      const live = liveInFlight.current
        ? ((pendingLiveWake.current = true), Promise.resolve())
        : (clearLiveTimer(), runLive());
      const background = backgroundInFlight.current
        ? ((pendingBackgroundWake.current = true), Promise.resolve())
        : (clearBackgroundTimer(), runBackground());
      return { live, background };
    }

    function wake() {
      const { live, background } = reconcile();
      void live;
      void background;
    }
    wakeRef.current = wake;

    async function refreshNow() {
      const { live, background } = reconcile();
      await Promise.all([live, background]);
    }
    refreshNowRef.current = refreshNow;

    function handleVisible() {
      if (document.visibilityState === "visible") wake();
    }
    function handleOnline() {
      if (navigator.onLine) wake();
    }

    window.addEventListener("focus", handleVisible);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisible);

    wake();

    return () => {
      disposed.current = true;
      clearLiveTimer();
      clearBackgroundTimer();
      window.removeEventListener("focus", handleVisible);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisible);
    };
    // `active` is the only thing that should tear down and rebuild the whole
    // scheduler; open/syncKey changes wake it through the effect below
    // instead (both read through refs here), so a conversation switch never
    // multiplies timers.
  }, [active]);

  /*
   * Conversation switch, pane change, or task-scope change: wake at once.
   * Wakes only when `syncKey` itself actually changed, tracked by diffing
   * against the last seen value rather than a run counter — an `active`
   * transition alone (the mount effect's own dependency) must never also
   * trigger this effect's wake, or the very first activation would wake the
   * scheduler twice.
   */
  const previousSyncKeyRef = useRef(syncKey);
  useEffect(() => {
    const changed = previousSyncKeyRef.current !== syncKey;
    previousSyncKeyRef.current = syncKey;
    if (!active || !changed) return;
    wakeRef.current();
  }, [syncKey, active]);

  const refreshNow = useCallback(async () => {
    await refreshNowRef.current();
  }, []);

  return { refreshNow };
}
