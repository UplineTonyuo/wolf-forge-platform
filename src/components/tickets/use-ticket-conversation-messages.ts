"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ticketConversationFingerprint } from "../../domain/tickets/live-scheduler";
import type { TicketDetailMessage } from "../../domain/tickets/schema";
import { useOptimisticTicketMessages } from "./use-optimistic-ticket-messages";
import { useTicketLiveSync } from "./use-ticket-live-sync";

/**
 * The one place a Ticket conversation's transcript is assembled, shared by the
 * staff and client wrappers so neither can drift from the other.
 *
 * Three inputs write to it, and they are ordered on purpose:
 *
 * 1. **The server render** (`serverMessages`). Authoritative, and the only one
 *    that runs before first paint.
 * 2. **The live lane.** Replaces the transcript in place when the other side
 *    does something, so a message arrives without a reload.
 * 3. **Optimistic sends.** Layered on top by `useOptimisticTicketMessages` and
 *    retired when the canonical list catches up — whichever source delivers
 *    the canonical copy first.
 *
 * Duplicate prevention is structural rather than a de-dupe pass: the live
 * payload *replaces* the canonical list instead of appending to it, so a
 * message that arrived both by `router.refresh()` and by the live lane exists
 * once. The optimistic layer only ever holds messages the canonical list does
 * not yet contain.
 */
export function useTicketConversationMessages({
  ticketId,
  serverMessages,
  mode,
  viewerProfileId,
}: {
  ticketId: string;
  serverMessages: TicketDetailMessage[];
  mode: "admin" | "client";
  viewerProfileId?: string | null;
}) {
  const [override, setOverride] = useState<TicketDetailMessage[] | null>(null);
  const [overrideBase, setOverrideBase] = useState(serverMessages);

  /*
   * A fresh server render — `router.refresh()` after a send — is at least as
   * new as anything the live lane delivered, so it supersedes the override.
   * Adjusted during render, the documented "adjust state when a prop changes"
   * pattern, so the first paint after the prop changes already shows the
   * server's list rather than painting one frame of superseded live data.
   */
  if (overrideBase !== serverMessages) {
    setOverrideBase(serverMessages);
    setOverride(null);
  }

  const canonical = override ?? serverMessages;

  /*
   * Read by the scheduler from a timer, never during render. Both refs are
   * refreshed by effects; being one render behind is harmless, because a
   * slightly stale fingerprint only costs one redundant payload that the
   * append-only guard below discards without touching the screen.
   */
  const canonicalRef = useRef(canonical);
  const fingerprintRef = useRef(ticketConversationFingerprint(serverMessages));
  useEffect(() => {
    canonicalRef.current = canonical;
    fingerprintRef.current = ticketConversationFingerprint(canonical);
  }, [canonical]);

  const getFingerprint = useCallback(() => fingerprintRef.current, []);

  const applyLive = useCallback((incoming: unknown[], fingerprint: string) => {
    const next = incoming as TicketDetailMessage[];
    const previous = canonicalRef.current;
    const incomingIds = new Set(next.map((message) => message.id));

    /*
     * The transcript is append-only, so ids only ever grow. A payload missing
     * a message already on screen is a read that began before a commit landed
     * — adopting it would blink a real message away. Ignore it; the next tick
     * carries it.
     */
    if (previous.some((message) => !incomingIds.has(message.id))) return false;

    /* Nothing a viewer would notice changed, so nothing is re-rendered. */
    if (fingerprint === fingerprintRef.current) return false;

    canonicalRef.current = next;
    fingerprintRef.current = fingerprint;
    setOverride(next);
    return true;
  }, []);

  const { wake } = useTicketLiveSync({
    ticketId,
    active: true,
    getFingerprint,
    onMessages: applyLive,
  });

  const optimistic = useOptimisticTicketMessages(canonical, { mode, viewerProfileId });

  /*
   * A local send, reply or attachment resolves here, and waking the lane
   * immediately means the sender's own canonical copy lands as fast as the
   * other side's does — the same reconcile path, not a special case.
   */
  const settle = (requestId: string, ok: boolean) => {
    optimistic.settle(requestId, ok);
    if (ok) wake();
  };

  return {
    messages: optimistic.messages,
    addOptimistic: optimistic.addOptimistic,
    retry: optimistic.retry,
    settle,
    wake,
  };
}
