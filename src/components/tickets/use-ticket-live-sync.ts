"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  computeTicketLiveDelayMs,
  nextTicketLiveTier,
  type TicketLiveTier,
} from "../../domain/tickets/live-scheduler";

type TicketLiveSyncOptions = {
  /** The ONLY Ticket this lane may ever ask about. */
  ticketId: string;
  /**
   * Whether the conversation is mounted. False tears the scheduler down
   * completely — no timer, no listener, no request.
   */
  active: boolean;
  /** The fingerprint the client already holds, so unchanged ticks return no payload. */
  getFingerprint: () => string;
  /**
   * Adopt an authoritative transcript. Return true only when it actually
   * changed what is on screen — that return value is what promotes the
   * scheduler back to FAST.
   */
  onMessages: (messages: unknown[], fingerprint: string) => boolean;
  onUnavailable?: () => void;
};

/**
 * The adaptive Ticket conversation scheduler.
 *
 * Adapted from `use-team-sync-controller.ts` (Team V2.5), with the two lanes
 * collapsed into one because a Ticket route has exactly one conversation to
 * keep current — there is no list, roster or task lane to run beside it — and
 * with the closed-drawer axis removed entirely, because this hook is mounted
 * by the conversation itself and unmounting is the only exit.
 *
 * Structure, all of it load-bearing:
 *
 * - **Recursive `setTimeout`, never `setInterval`.** The delay for the next
 *   tick is recomputed after every response, so the cadence follows activity
 *   rather than being fixed at mount, and there is structurally never more
 *   than one request outstanding for this conversation.
 * - **Single-flight.** An in-flight tick is never overlapped; a wake that
 *   arrives mid-request sets a flag and the tick's own completion reschedules
 *   immediately instead of waiting out the computed delay.
 * - **Hidden tab and offline schedule NOTHING.** `suspended()` is checked
 *   before a timer is armed and again when it fires, so a backgrounded tab
 *   reaches zero scheduled Ticket requests rather than a slower poll.
 *   Returning to visible or online wakes it at once and reconciles.
 * - **Bounded backoff.** Consecutive failures lengthen the wait and can never
 *   hot-loop an expired session.
 * - **Jitter** on every scheduled tick, so many open Tickets do not
 *   synchronize their clocks.
 * - **Abort on teardown**, so navigating away stops a request already in
 *   flight rather than merely stopping the next one.
 *
 * All policy lives in `src/domain/tickets/live-scheduler.ts`; this hook owns
 * only the real timer and the browser event listeners.
 */
export function useTicketLiveSync({
  ticketId,
  active,
  getFingerprint,
  onMessages,
  onUnavailable,
}: TicketLiveSyncOptions) {
  const fingerprintRef = useRef(getFingerprint);
  const onMessagesRef = useRef(onMessages);
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => {
    fingerprintRef.current = getFingerprint;
    onMessagesRef.current = onMessages;
    onUnavailableRef.current = onUnavailable;
  }, [getFingerprint, onMessages, onUnavailable]);

  /*
   * Mutable scheduler state, never React state: it changes on every tick and
   * none of it should cause a render — only real transcript changes do that.
   */
  const scheduleState = useRef({
    tier: "fast" as TicketLiveTier,
    /* Placeholder, not a real timestamp: `Date.now()` during render would be an
       impure render. The mount effect's first `wake()` sets it via
       `markActivity()` before anything reads it. */
    lastActivityAt: 0,
    failures: 0,
  });

  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!active || !ticketId) return;
    let cancelled = false;
    let inFlight = false;
    let pendingWake = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let unavailable = false;

    const suspended = () =>
      document.visibilityState !== "visible" || !navigator.onLine;

    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const markActivity = () => {
      scheduleState.current.lastActivityAt = Date.now();
      scheduleState.current.tier = "fast";
    };

    const schedule = (immediate: boolean) => {
      clearTimer();
      if (cancelled || unavailable || suspended()) return;
      const tier = nextTicketLiveTier(Date.now() - scheduleState.current.lastActivityAt);
      scheduleState.current.tier = tier;
      const delay = immediate
        ? 0
        : computeTicketLiveDelayMs({ tier, failureCount: scheduleState.current.failures });
      timer = setTimeout(() => {
        void run();
      }, delay);
    };

    async function run() {
      if (cancelled || suspended() || inFlight) return;
      inFlight = true;
      let changed = false;
      try {
        const abort = new AbortController();
        controller = abort;
        const response = await fetch("/api/ticket-live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          signal: abort.signal,
          body: JSON.stringify({
            ticket_id: ticketId,
            fingerprint: fingerprintRef.current(),
          }),
        });

        const payload = (await response.json().catch(() => null)) as
          | {
              ok?: boolean;
              code?: string;
              data?: { ticketId?: string; fingerprint?: string; changed?: boolean; messages?: unknown[] | null };
            }
          | null;

        if (cancelled) return;
        if (response.status === 401 || response.status === 403 || response.status === 404
          || payload?.code === "PERMISSION_DENIED" || payload?.code === "NOT_FOUND") {
          unavailable = true;
          onUnavailableRef.current?.();
        } else if (payload?.ok && payload.data) {
          scheduleState.current.failures = 0;
          const data = payload.data;
          /*
           * The id check is the cross-Ticket guard. A response that resolved
           * after the viewer moved on belongs to a conversation that is no
           * longer mounted, so it is discarded rather than applied.
           */
          if (
            data.changed &&
            data.ticketId === ticketId &&
            Array.isArray(data.messages) &&
            typeof data.fingerprint === "string"
          ) {
            changed = onMessagesRef.current(data.messages, data.fingerprint);
          }
        } else {
          scheduleState.current.failures += 1;
        }
      } catch {
        if (!cancelled) scheduleState.current.failures += 1;
      } finally {
        controller = null;
        inFlight = false;
      }

      if (changed) markActivity();
      const immediate = pendingWake;
      pendingWake = false;
      schedule(immediate);
    }

    /**
     * Cancel whatever is scheduled and reconcile now. A tick already in flight
     * is asked to reschedule immediately on completion rather than being
     * duplicated.
     */
    function wake() {
      markActivity();
      if (cancelled || suspended()) return;
      if (inFlight) {
        pendingWake = true;
        return;
      }
      clearTimer();
      void run();
    }
    wakeRef.current = wake;

    const handleVisible = () => {
      if (document.visibilityState === "visible") wake();
    };
    const handleOnline = () => {
      if (navigator.onLine) wake();
    };

    window.addEventListener("focus", wake);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisible);

    wake();

    return () => {
      cancelled = true;
      clearTimer();
      controller?.abort();
      controller = null;
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisible);
    };
    /*
     * `ticketId` is a dependency on purpose: switching Tickets must tear the
     * scheduler down and rebuild it against the new id, so a tick can never
     * carry a fingerprint computed for a different conversation.
     */
  }, [active, ticketId]);

  return { wake: useCallback(() => wakeRef.current(), []) };
}
