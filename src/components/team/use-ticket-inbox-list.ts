"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applyTeamJitter, teamBackoffIntervalMs } from "../../domain/team/live-scheduler";
import { listTicketSummariesAction } from "../../app/actions/tickets";
import type { TicketSummary } from "../../domain/tickets/schema";

/**
 * One list-level poller for the Inbox drawer's Tickets pane.
 *
 * Deliberately separate from `domain/tickets/live-scheduler.ts`, which is
 * per-conversation-fingerprint policy for the selected Ticket's transcript
 * (see useTicketLiveSync) and is not reused here. A Ticket list changing
 * status/assignee has no sub-second reactivity requirement the way a live
 * transcript does, so this reuses only the generic jitter/backoff primitives
 * from Team's scheduler rather than adopting its multi-tier fast/warm/quiet
 * model wholesale.
 *
 * Single-flight, zero timers while hidden/offline/inactive, recursive
 * setTimeout (never setInterval), immediate refresh on focus/online/wake.
 */
const TICKET_INBOX_LIST_INTERVAL_MS = 8_000;

export function useTicketInboxList(active: boolean) {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const disposedRef = useRef(false);
  const failureCountRef = useRef(0);

  const suspended = useCallback(
    () =>
      !activeRef.current ||
      document.visibilityState !== "visible" ||
      !navigator.onLine,
    [],
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const runRef = useRef<() => Promise<void>>(async () => {});

  const schedule = useCallback(
    (delayMs: number) => {
      clearTimer();
      if (disposedRef.current || suspended()) return;
      timerRef.current = window.setTimeout(() => void runRef.current(), delayMs);
    },
    [clearTimer, suspended],
  );

  const run = useCallback(async () => {
    if (disposedRef.current || inFlightRef.current || suspended()) return;
    inFlightRef.current = true;
    const result = await listTicketSummariesAction();
    inFlightRef.current = false;
    if (disposedRef.current) return;

    if (!result.ok) {
      failureCountRef.current += 1;
      setError(result.error);
      schedule(applyTeamJitter(teamBackoffIntervalMs(failureCountRef.current)));
      return;
    }

    failureCountRef.current = 0;
    setTickets(result.data);
    setError(null);
    setLoaded(true);
    schedule(applyTeamJitter(TICKET_INBOX_LIST_INTERVAL_MS));
  }, [schedule, suspended]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const refreshNow = useCallback(() => {
    clearTimer();
    void run();
  }, [clearTimer, run]);

  useEffect(() => {
    if (!active) {
      clearTimer();
      return;
    }
    void (async () => {
      await run();
    })();

    const wake = () => {
      if (!suspended()) refreshNow();
    };
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);

    return () => {
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [active, clearTimer, refreshNow, run, suspended]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      clearTimer();
    };
  }, [clearTimer]);

  return { tickets, loaded, error, refreshNow };
}
