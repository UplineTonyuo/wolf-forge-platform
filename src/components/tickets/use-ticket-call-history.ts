"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { callHistoryEntry, type CallHistoryEntry } from "../../domain/tickets/calls";
import { useInboxCalls } from "../calls/call-provider";
import { compareConversationTime } from "../../domain/orders/conversation-page";

type ControlledHistory = { entries: CallHistoryEntry[]; onPage: (page: CallHistoryEntry[], older: boolean) => void; onClear: () => void; resetKey?: number };
export function useTicketCallHistory(ticketId: string, order = false, controlled?: ControlledHistory) {
  const controller = useInboxCalls();
  const resetKey=controlled?.resetKey??0;
  const [state, setState] = useState<{ ticketId: string; entries: CallHistoryEntry[]; more: boolean; error: string; busy: boolean }>({ ticketId, entries: [], more: false, error: "", busy: false });
  const generation = useRef(0), inFlight = useRef(false), pending = useRef(false);
  const cursor = useRef<CallHistoryEntry | null>(null);
  const [retryable, setRetryable] = useState(true);
  const run = useRef<() => Promise<void>>(async () => {});
  const controlledRef = useRef(controlled);
  useEffect(()=>{controlledRef.current=controlled},[controlled]);
  const active = state.ticketId === ticketId;
  const entries = active ? controlled?.entries ?? state.entries : [];
  const load = useCallback(async (older = false) => {
    if (inFlight.current) { if (!older) pending.current = true; return; }
    inFlight.current = true;
    const current = generation.current;
    setState(previous => ({ ...(previous.ticketId === ticketId ? previous : { ticketId, entries: [], more: false, error: "" }), busy: true }));
    try {
      const retained=controlledRef.current?.entries;
      const oldest=retained?.reduce<CallHistoryEntry|null>((previous,entry)=>!previous||compareConversationTime(entry.requestedAt,previous.requestedAt)<0||entry.requestedAt===previous.requestedAt&&entry.id<previous.id?entry:previous,null);
      const before = older ? oldest ?? cursor.current : null;
      const query = new URLSearchParams({ action: "history", ...(order ? { order_id: ticketId } : { ticket_id: ticketId }), ...(before ? { before: before.requestedAt, before_id: before.id } : {}) });
      const response = await fetch(`/api/ticket-calls?${query}`, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000) });
      if (current !== generation.current) return;
      if ([401, 403, 404].includes(response.status)) {
        const failure = await response.json().catch(() => null);
        if (current !== generation.current) return;
        const support = failure?.code === "SUPPORT_MODE";
        setRetryable(false);
        cursor.current = null;
        controlledRef.current?.onClear();
        setState({ ticketId, entries: [], more: false, busy: false, error: support ? "Calls and call history are disabled in client-support sessions. Use your own signed-in account for calling." : response.status === 401 ? "Your session expired. Sign in again to view call history." : "You don’t have access to call history for this conversation." }); return;
      }
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(response.status === 429 ? "RATE_LIMITED" : "History unavailable");
      const page = z.array(callHistoryEntry).max(50).parse(result.data);
      if (current !== generation.current) return;
      if (older || !cursor.current) cursor.current = page.at(-1) ?? null;
      controlledRef.current?.onPage(page,older);
      setState(previous => ({ ticketId, entries: controlledRef.current ? [] : [...new Map([...(previous.ticketId === ticketId ? previous.entries : []), ...page].map(call => [call.id, call])).values()], more: older ? page.length === 50 : page.length === 50 || (previous.ticketId === ticketId && previous.more), busy: false, error: "" }));
    } catch (error) {
      if (current === generation.current) {
        setRetryable(true);
        setState(previous => ({ ...previous, busy: false, error: error instanceof Error && error.message === "RATE_LIMITED" ? "Call history request limit reached. Wait a moment, then try again." : "Call history could not be loaded. Try again." }));
      }
    } finally {
      if (current === generation.current) {
        inFlight.current = false;
        if (pending.current) { pending.current = false; void run.current(); }
      }
    }
  }, [ticketId, order]);
  useEffect(() => { run.current = load; }, [load]);
  useEffect(() => {
    const current = ++generation.current; inFlight.current = false; pending.current = false; cursor.current = null;
    queueMicrotask(() => { if (current === generation.current) setRetryable(true); });
    queueMicrotask(() => { if (current === generation.current) void load(); });
    let last = "";
    const unsubscribe = controller?.subscribe(() => {
      const call = controller.snapshot().call;
      if (!call || (order ? call.orderId : call.ticketId) !== ticketId) return;
      const version = `${call.id}:${call.version}:${call.state}`;
      if (version !== last) { last = version; void load(); }
    });
    const wake = () => { void load(); };
    window.addEventListener("wolf-forge-call-history", wake);
    return () => { generation.current = current + 1; unsubscribe?.(); window.removeEventListener("wolf-forge-call-history", wake); };
  }, [controller, load, ticketId, order, resetKey]);
  return { entries, more: active && state.more, busy: active && state.busy, error: active ? state.error : "", retryable, load };
}
