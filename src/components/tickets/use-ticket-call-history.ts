"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { callHistoryEntry, type CallHistoryEntry } from "../../domain/tickets/calls";
import { useInboxCalls } from "../calls/call-provider";

export function useTicketCallHistory(ticketId: string) {
  const controller = useInboxCalls();
  const [state, setState] = useState<{ ticketId: string; entries: CallHistoryEntry[]; more: boolean; error: string; busy: boolean }>({ ticketId, entries: [], more: false, error: "", busy: false });
  const generation = useRef(0), inFlight = useRef(false), pending = useRef(false);
  const cursor = useRef<CallHistoryEntry | null>(null);
  const run = useRef<() => Promise<void>>(async () => {});
  const active = state.ticketId === ticketId;
  const entries = active ? state.entries : [];
  const load = useCallback(async (older = false) => {
    if (inFlight.current) { if (!older) pending.current = true; return; }
    inFlight.current = true;
    const current = generation.current;
    setState(previous => ({ ...(previous.ticketId === ticketId ? previous : { ticketId, entries: [], more: false, error: "" }), busy: true }));
    try {
      const before = older ? cursor.current : null;
      const query = new URLSearchParams({ action: "history", ticket_id: ticketId, ...(before ? { before: before.requestedAt, before_id: before.id } : {}) });
      const response = await fetch(`/api/ticket-calls?${query}`, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000) });
      if (current !== generation.current) return;
      if ([401, 403, 404].includes(response.status)) {
        cursor.current = null;
        setState({ ticketId, entries: [], more: false, busy: false, error: "Call history is unavailable." }); return;
      }
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error("History unavailable");
      const page = z.array(callHistoryEntry).max(50).parse(result.data);
      if (current !== generation.current) return;
      if (older || !cursor.current) cursor.current = page.at(-1) ?? null;
      setState(previous => ({ ticketId, entries: [...new Map([...(previous.ticketId === ticketId ? previous.entries : []), ...page].map(call => [call.id, call])).values()], more: older ? page.length === 50 : page.length === 50 || (previous.ticketId === ticketId && previous.more), busy: false, error: "" }));
    } catch {
      if (current === generation.current) setState(previous => ({ ...previous, busy: false, error: "Call history could not be loaded. Try again." }));
    } finally {
      if (current === generation.current) {
        inFlight.current = false;
        if (pending.current) { pending.current = false; void run.current(); }
      }
    }
  }, [ticketId]);
  useEffect(() => { run.current = load; }, [load]);
  useEffect(() => {
    const current = ++generation.current; inFlight.current = false; pending.current = false; cursor.current = null;
    queueMicrotask(() => { if (current === generation.current) void load(); });
    let last = "";
    const unsubscribe = controller?.subscribe(() => {
      const call = controller.snapshot().call;
      if (call?.ticketId !== ticketId) return;
      const version = `${call.id}:${call.version}:${call.state}`;
      if (version !== last) { last = version; void load(); }
    });
    const wake = () => { void load(); };
    window.addEventListener("wolf-forge-call-history", wake);
    return () => { generation.current = current + 1; unsubscribe?.(); window.removeEventListener("wolf-forge-call-history", wake); };
  }, [controller, load, ticketId]);
  return { entries, more: active && state.more, busy: active && state.busy, error: active ? state.error : "", load };
}
