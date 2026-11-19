"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applyTeamJitter, teamBackoffIntervalMs } from "../../domain/team/live-scheduler";
import { listTicketSummariesAction } from "../../app/actions/tickets";
import { ticketInboxPageSize, type TicketSummary } from "../../domain/tickets/schema";
import { notifyTicketAccessUnavailable } from "../tickets/ticket-access-boundary";
import { useTicketCacheRevocation } from "../tickets/use-ticket-cache-revocation";

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

export function useTicketInboxList(active: boolean, onUnavailable?: () => void) {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [pages, setPages] = useState(0);
  const [request, setRequest] = useState({ page: 1, query: "" });
  const latestRequest = useRef(request);
  const changeRequest = useCallback((page: number, query: string) => {
    const next = { page, query };
    latestRequest.current = next;
    setRequest(next);
    setTickets([]);
    setError(null);
    setLoaded(false);
  }, []);
  const onPageChange = (page: number) => changeRequest(page, latestRequest.current.query);
  const onQueryChange = (query: string) => {
    setPages(0);
    changeRequest(1, query);
  };
  const cacheGeneration = useRef(0);
  useTicketCacheRevocation(() => {
    setTickets([]);
    setPages(0);
    setUnavailable(true);
    setError("Tickets are unavailable.");
    setLoaded(true);
  }, cacheGeneration);

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
    const generation = cacheGeneration.current;
    const pending = latestRequest.current;
    const result = await listTicketSummariesAction(pending.page, pending.query).catch(() => ({
      ok: false as const, error: "Tickets could not be refreshed.", code: undefined,
    }));
    inFlightRef.current = false;
    if (disposedRef.current) return;
    if (generation !== cacheGeneration.current) {
      schedule(applyTeamJitter(TICKET_INBOX_LIST_INTERVAL_MS));
      return;
    }

    // Access loss applies to the entire drawer, even if the requested page changed.
    if (!result.ok && (result.code === "PERMISSION_DENIED" || result.code === "NOT_FOUND")) {
      setError(result.error);
      setTickets([]);
      setPages(0);
      setUnavailable(true);
      setLoaded(true);
      clearTimer();
      notifyTicketAccessUnavailable();
      onUnavailable?.();
      return;
    }

    if (pending !== latestRequest.current) {
      schedule(0);
      return;
    }

    if (!result.ok) {
      failureCountRef.current += 1;
      setError(result.error);
      schedule(applyTeamJitter(teamBackoffIntervalMs(failureCountRef.current)));
      return;
    }

    failureCountRef.current = 0;
    const pageCount = Math.max(1, Math.ceil(result.data.total / ticketInboxPageSize));
    setPages(pageCount);
    if (pending.page > pageCount) {
      changeRequest(pageCount, pending.query);
      return;
    }
    setTickets(result.data.tickets);
    setError(null);
    setUnavailable(false);
    setLoaded(true);
    schedule(applyTeamJitter(TICKET_INBOX_LIST_INTERVAL_MS));
  }, [schedule, suspended, clearTimer, onUnavailable, changeRequest]);

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
  }, [active, clearTimer, refreshNow, run, suspended, request]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      clearTimer();
    };
  }, [clearTimer]);

  return { page: request.page, pages, query: request.query, onPageChange, onQueryChange, tickets: active ? tickets : [], loaded, error, unavailable, refreshNow };
}
