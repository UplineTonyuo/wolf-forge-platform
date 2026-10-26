"use client";

import { Mic, PhoneOff, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyCall } from "@daily-co/daily-js";
import { PortalDialog } from "../account/ui/portal-dialog";
import styles from "./ticket-call-controls.module.css";
import { randomUuid } from "../../lib/random-uuid";

type CallMode = "audio" | "video";
type CallStatus = "ready" | "joining" | "joined" | "ended" | "error";

export function TicketCallControls({ ticketId, disabled = false }: { ticketId: string; disabled?: boolean }) {
  const [eligibility, setEligibility] = useState<{ ticketId: string; enabled: boolean } | null>(null);
  const [selection, setSelection] = useState<{ ticketId: string; mode: CallMode } | null>(null);
  const [available, setAvailable] = useState<{ ticketId: string; id: string; mode: CallMode } | null>(null);
  const enabled = eligibility?.ticketId === ticketId && eligibility.enabled;
  const selectedMode = selection?.ticketId === ticketId && !disabled ? selection.mode : null;

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    let stopped = false;
    async function check() {
      if (pending || stopped || document.visibilityState === "hidden") return;
      pending = true;
      try { const response = await fetch(`/api/ticket-calls?ticket_id=${encodeURIComponent(ticketId)}`, {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
      if (!response.ok) {
        if (!stopped && [401,403,404].includes(response.status)) setEligibility({ ticketId, enabled: false });
        return;
      }
      const result: unknown = await response.json();
      if (!stopped && result && typeof result === "object" && "ok" in result && result.ok === true && "enabled" in result) {
        setEligibility({ ticketId, enabled: result.enabled === true });
        const call = "call" in result ? result.call : null;
        setAvailable(call && typeof call === "object" && "id" in call && typeof call.id === "string" &&
          "mode" in call && (call.mode === "audio" || call.mode === "video") ? { ticketId, id: call.id, mode: call.mode } : null);
      }
      } catch { /* Keep a known active call through a transient status outage. */ }
      finally { pending = false; }
    }
    void check();
    const interval = setInterval(() => void check(), 5000);
    document.addEventListener("visibilitychange", check);
    return () => { stopped = true; controller.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", check); };
  }, [ticketId]);

  if (!enabled) return null;

  return (
    <>
      <div className={styles.controls} aria-label="Conversation calls">
        {available?.ticketId === ticketId ? <button type="button" className={styles.callButton} disabled={disabled} onClick={() => setSelection({ ticketId, mode: available.mode })}>
          <Mic aria-hidden="true" /> Join {available.mode === "audio" ? "voice" : "video"} call
        </button> : <><button type="button" className={styles.callButton} disabled={disabled} onClick={() => setSelection({ ticketId, mode: "audio" })}>
          <Mic aria-hidden="true" /> Voice call
        </button>
        <button type="button" className={styles.callButton} disabled={disabled} onClick={() => setSelection({ ticketId, mode: "video" })}>
          <Video aria-hidden="true" /> Video call
        </button></>}
      </div>
      <PortalDialog
        open={selectedMode !== null}
        onClose={() => setSelection(null)}
        title={selectedMode === "audio" ? "Voice call" : "Video call"}
        description="Private conversation call · 15-minute limit"
        closeOnBackdrop={false}
        size="wide"
      >
        {selectedMode ? <CallSession key={`${ticketId}:${selectedMode}`} ticketId={ticketId} mode={selectedMode} onClose={() => setSelection(null)} /> : null}
      </PortalDialog>
    </>
  );
}

function CallSession({ ticketId, mode, onClose }: { ticketId: string; mode: CallMode; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<DailyCall | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const expiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(randomUuid());
  const callIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<CallStatus>("ready");
  const [message, setMessage] = useState("");

  const release = useCallback(() => {
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    if (expiryRef.current) clearTimeout(expiryRef.current);
    expiryRef.current = null;
    if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
    connectTimeoutRef.current = null;
    const frame = frameRef.current;
    frameRef.current = null;
    if (frame) void frame.destroy().catch(() => {});
  }, []);

  const endRemote = useCallback(() => {
    const callId = callIdRef.current;
    callIdRef.current = null;
    if (callId) void fetch("/api/ticket-calls", {
      method: "DELETE", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket_id: ticketId, call_id: callId }),
    }).catch(() => undefined);
  }, [ticketId]);

  useEffect(() => {
    const shutdown = () => { release(); endRemote(); };
    window.addEventListener("beforeunload", shutdown);
    return () => {
      window.removeEventListener("beforeunload", shutdown);
      shutdown();
    };
  }, [release, endRemote]);

  async function join() {
    if (requestRef.current || frameRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const generation = ++generationRef.current;
    const current = () => !controller.signal.aborted && generationRef.current === generation;
    setStatus("joining");
    setMessage("");

    try {
      const response = await fetch("/api/ticket-calls", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: ticketId, mode, request_id: requestIdRef.current }),
        signal: controller.signal,
      });
      if (!current()) return;
      if (response.status === 403 || response.status === 404) {
        release();
        setStatus("ended");
        setMessage("This call is no longer available.");
        return;
      }
      if (!response.ok) throw new Error("Call unavailable");
      const result = await response.json();
      const data = result?.data;
      const expiresAt = typeof data?.expiresAt === "string" ? Date.parse(data.expiresAt) : NaN;
      if (!result?.ok || typeof data?.roomUrl !== "string" || typeof data?.token !== "string" || data.mode !== mode || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error("Invalid call details");
      }
      if (!/^https:\/\/wolfforge\.daily\.co\/wf-call-[a-f0-9-]{36}$/.test(data.roomUrl) || typeof data.callId !== "string") throw new Error("Invalid call room");
      callIdRef.current = data.callId;
      if (!current()) return;
      const Daily = (await import("@daily-co/daily-js")).default;
      if (!current() || !containerRef.current) return;
      if (expiresAt <= Date.now()) throw new Error("Call expired");
      const frame = Daily.createFrame(containerRef.current, {
        iframeStyle: { width: "100%", height: "100%", border: "0" },
        showLeaveButton: true,
        showFullscreenButton: true,
        showUserNameChangeUI: false,
        ...(mode === "audio" ? { videoSource: false, startVideoOff: true } : {}),
      });
      frameRef.current = frame;
      const iframe = frame.iframe();
      if (iframe) iframe.title = mode === "audio" ? "Private voice call" : "Private video call";
      frame.on("left-meeting", () => {
        if (!current()) return;
        release();
        setStatus("ended");
        setMessage("Call ended.");
      });
      connectTimeoutRef.current = setTimeout(() => {
        if (!current()) return;
        release(); setStatus("error"); setMessage("The call did not connect. Check microphone and camera access, then try again.");
      }, 45000);
      frame.on("error", () => {
        if (!current()) return;
        release();
        setStatus("error");
        setMessage("We couldn’t connect the call. Check your connection and device permissions, then try again.");
      });
      expiryRef.current = setTimeout(() => {
        if (!current()) return;
        release();
        setStatus("ended");
        setMessage("This call has ended.");
      }, Math.min(expiresAt - Date.now(), 2_147_483_647));
      await frame.join({ url: data.roomUrl, token: data.token, ...(mode === "audio" ? { videoSource: false, startVideoOff: true } : {}) });
      if (current()) {
        if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
        requestRef.current = null;
        setStatus("joined");
      }
    } catch {
      if (!current()) return;
      release();
      setStatus("error");
      setMessage("We couldn’t connect the call. Check your connection and device permissions, then try again.");
    }
  }

  const active = status === "joining" || status === "joined";

  return (
    <div className={styles.session}>
      {status === "ready" ? <p className={styles.hint}>{mode === "audio" ? "Join with your microphone. Your camera stays off." : "Join when you’re ready to use your camera and microphone."}</p> : null}
      {status === "joining" ? <p className={styles.hint} role="status">Connecting your call…</p> : null}
      {message ? <p className={styles.hint} role={status === "error" ? "alert" : "status"}>{message}</p> : null}
      <div ref={containerRef} className={styles.frame} data-active={active || undefined} />
      <div className={styles.actions}>
        <button type="button" className={`${styles.callButton} ${active ? styles.endButton : ""}`} onClick={onClose}>
          {active ? <PhoneOff aria-hidden="true" /> : null}{active ? "End call" : "Close"}
        </button>
        {status === "ready" || status === "error" ? <button type="button" className={`${styles.callButton} ${styles.joinButton}`} onClick={() => void join()}>{status === "error" ? "Try again" : "Join call"}</button> : null}
      </div>
    </div>
  );
}
