"use client";

import { AlertCircle, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchTeamVoicePlayback } from "./team-http-client";
import styles from "./team-messages.module.css";

function clock(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function TeamVoiceMessage({ conversationId, messageId, durationMs, expired }: {
  conversationId: string;
  messageId: string;
  durationMs: number;
  expired: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  async function loadAndPlay(forceRefresh = false) {
    if (expired || loading) return;
    setError(null);
    let nextUrl = forceRefresh ? null : url;
    if (!nextUrl) {
      setLoading(true);
      const result = await fetchTeamVoicePlayback({ conversationId, messageId });
      setLoading(false);
      if (!result.ok) { setError(result.error); return; }
      nextUrl = result.data.url;
      setUrl(nextUrl);
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.src !== nextUrl) audio.src = nextUrl;
    try { await audio.play(); } catch { setError("Voice recording could not be played."); }
  }

  if (expired) return <span className={styles.voiceExpired}><AlertCircle aria-hidden="true" /> Recording expired</span>;

  return (
    <div className={styles.voiceMessage}>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPosition(0); }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime * 1000)}
        onError={() => { setPlaying(false); setUrl(null); setError("Playback link expired or could not be loaded."); }}
      />
      <button
        type="button"
        className={styles.voicePlayButton}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        aria-busy={loading || undefined}
        disabled={loading}
        onClick={() => {
          if (playing) audioRef.current?.pause();
          else void loadAndPlay();
        }}
      >
        {loading ? <Loader2 className={styles.spin} aria-hidden="true" /> : playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </button>
      <progress max={Math.max(1, durationMs)} value={Math.min(position, durationMs)} aria-label="Voice message progress" />
      <span>{clock(position || durationMs)}</span>
      {error ? (
        <button type="button" className={styles.voiceRetry} onClick={() => void loadAndPlay(true)} aria-label="Retry voice message">
          <RotateCcw aria-hidden="true" /> Retry
        </button>
      ) : null}
    </div>
  );
}
