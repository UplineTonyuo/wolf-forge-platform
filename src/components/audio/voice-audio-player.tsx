"use client";

import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { TICKET_ATTACHMENT_MAX_BYTES, TICKET_AUDIO_MAX_DURATION_MS } from "../../lib/tickets/ticket-attachment-file";
import { webmOpusDurationMs } from "../../lib/tickets/webm-opus-duration";
import { oggOpusDurationMs } from "../../lib/tickets/ogg-opus-duration";
import styles from "./voice-audio.module.css";

let activePlayback: (() => void) | null = null;

export function voiceClock(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 0) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function validDuration(value: number) {
  return Number.isFinite(value) && value > 0 && value <= TICKET_AUDIO_MAX_DURATION_MS;
}

async function readAudioBlob(url: string, signal: AbortSignal) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal });
  const mime = response.headers.get("Content-Type") ?? "";
  if (!response.ok || !mime.toLowerCase().startsWith("audio/") || Number(response.headers.get("Content-Length")) > TICKET_ATTACHMENT_MAX_BYTES) {
    throw new Error("Recording could not be loaded.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Recording could not be loaded.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > TICKET_ATTACHMENT_MAX_BYTES || signal.aborted) throw new Error("Recording exceeds the playback limit.");
      chunks.push(new Uint8Array(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!size) throw new Error("Recording is empty.");
  return new Blob(chunks, { type: mime });
}

export function VoiceAudioPlayer({ source, durationMs = 0, label = "voice message", disabled = false }: {
  source: string | Blob | ((signal: AbortSignal) => Promise<string>);
  durationMs?: number;
  label?: string;
  disabled?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const aliveRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const cachedUrlRef = useRef<string | null>(null);
  const ownedUrlRef = useRef<string | null>(null);
  const [total, setTotal] = useState(validDuration(durationMs) ? durationMs : 0);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<"permission" | "playback" | null>(null);
  const [previous, setPrevious] = useState({ source, durationMs });

  if (previous.source !== source || previous.durationMs !== durationMs) {
    setPrevious({ source, durationMs });
    setTotal(validDuration(durationMs) ? durationMs : 0);
    setPosition(0);
    setReady(false);
    setError(null);
  }

  const pause = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    audioRef.current?.pause();
    if (aliveRef.current) { setLoading(false); setPlaying(false); }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    const audio = audioRef.current;
    return () => {
      aliveRef.current = false;
      pause();
      if (activePlayback === pause) activePlayback = null;
      audio?.removeAttribute("src");
      audio?.load();
      if (ownedUrlRef.current) URL.revokeObjectURL(ownedUrlRef.current);
      cachedUrlRef.current = null;
      ownedUrlRef.current = null;
    };
  }, [pause, source]);

  useEffect(() => { if (disabled) pause(); }, [disabled, pause]);

  function fail() {
    if (!aliveRef.current) return;
    pause();
    if (activePlayback === pause) activePlayback = null;
    if (ownedUrlRef.current) URL.revokeObjectURL(ownedUrlRef.current);
    ownedUrlRef.current = null;
    cachedUrlRef.current = null;
    const audio = audioRef.current;
    if (audio) { audio.removeAttribute("src"); audio.load(); }
    setPosition(0);
    setReady(false);
    setError("playback");
  }

  async function play() {
    if (disabled || requestRef.current) return;
    activePlayback?.();
    activePlayback = pause;
    const request = new AbortController();
    requestRef.current = request;
    setLoading(true);
    setError(null);
    try {
      let url = cachedUrlRef.current;
      if (!url) {
        const resolved = typeof source === "function" ? await source(request.signal) : source;
        if (request.signal.aborted || !aliveRef.current) return;
        const blob = resolved instanceof Blob ? resolved : !validDuration(durationMs) ? await readAudioBlob(resolved, request.signal) : null;
        if (blob) {
          if (!blob.size || blob.size > TICKET_ATTACHMENT_MAX_BYTES) throw new Error("Invalid recording size.");
          const mime = blob.type.split(";")[0]?.toLowerCase();
          if (!validDuration(durationMs)) {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const measured = mime === "audio/webm" ? webmOpusDurationMs(bytes) : mime === "audio/ogg" ? oggOpusDurationMs(bytes) : 0;
            if (!validDuration(measured)) throw new Error("Recording duration is unavailable.");
            if (!request.signal.aborted && aliveRef.current) setTotal(measured);
          }
          if (request.signal.aborted || !aliveRef.current) return;
          url = URL.createObjectURL(blob);
          ownedUrlRef.current = url;
        } else url = resolved as string;
        cachedUrlRef.current = url;
      }
      if (request.signal.aborted || !aliveRef.current || activePlayback !== pause) return;
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.getAttribute("src") !== url) { audio.src = url; audio.load(); }
      await audio.play();
      if (request.signal.aborted || !aliveRef.current || activePlayback !== pause) return;
      setPlaying(true);
    } catch (error) {
      if (!request.signal.aborted && aliveRef.current) {
        if (error instanceof DOMException && error.name === "NotAllowedError" && cachedUrlRef.current) {
          // A second gesture can play already-loaded media on browsers that expire activation during fetch.
          pause();
          setError("permission");
        } else fail();
      }
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        if (aliveRef.current) setLoading(false);
      }
    }
  }

  return <div className={styles.player} data-error={error || undefined}>
    <audio ref={audioRef} preload="none" onPlay={() => {
      if (activePlayback !== pause) audioRef.current?.pause();
      else setPlaying(true);
    }} onPause={() => setPlaying(false)} onLoadedMetadata={(event) => {
      if (!total && validDuration(event.currentTarget.duration * 1000)) setTotal(event.currentTarget.duration * 1000);
    }} onCanPlay={() => setReady(true)} onTimeUpdate={(event) => {
      const current = event.currentTarget.currentTime * 1000;
      if (Number.isFinite(current)) setPosition(Math.max(0, Math.min(total || Infinity, current)));
    }}
    onEnded={(event) => { event.currentTarget.currentTime = 0; setPosition(0); setPlaying(false); }} onError={fail} />
    <button type="button" className={styles.play} disabled={disabled || loading} aria-busy={loading || undefined}
      aria-label={`${error === "playback" ? "Retry" : playing ? "Pause" : "Play"} ${label}`} onClick={() => playing ? pause() : void play()}>
      {loading ? <Loader2 className={styles.spin} aria-hidden="true" /> : error === "playback" ? <RotateCcw aria-hidden="true" /> : playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
    </button>
    <div className={styles.track}>
      <input type="range" min="0" max={total ? total / 1000 : 1} step="0.1" value={Math.min(position, total) / 1000}
        disabled={disabled || loading || !ready || !total} aria-label={`Seek ${label}`}
        aria-valuetext={`${voiceClock(position)} of ${total ? voiceClock(total) : "duration unavailable"}`}
        onChange={(event) => {
          const next = Math.max(0, Math.min(total, Number(event.currentTarget.value) * 1000));
          if (audioRef.current && Number.isFinite(next)) {
            try { audioRef.current.currentTime = next / 1000; setPosition(next); }
            catch { setReady(false); }
          }
        }} />
      <span className={styles.time}><span aria-label="Elapsed time">{voiceClock(position)}</span><span aria-hidden="true"> / </span><span aria-label="Total duration">{total ? voiceClock(total) : "--:--"}</span></span>
    </div>
    {error ? <span className={styles.error} role="alert">{error === "permission" ? "Press Play to start this recording." : "Recording could not be played. Try again."}</span> : null}
  </div>;
}
