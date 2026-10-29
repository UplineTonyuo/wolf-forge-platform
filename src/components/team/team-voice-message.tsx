"use client";

import { AlertCircle } from "lucide-react";
import { useCallback } from "react";
import { VoiceAudioPlayer } from "../audio/voice-audio-player";
import { fetchTeamVoicePlayback } from "./team-http-client";
import styles from "./team-messages.module.css";

export function TeamVoiceMessage({ conversationId, messageId, durationMs, expired }: {
  conversationId: string;
  messageId: string;
  durationMs: number;
  expired: boolean;
}) {
  const source = useCallback(async (signal: AbortSignal) => {
    const result = await fetchTeamVoicePlayback({ conversationId, messageId }, signal);
    if (!result.ok) throw new Error(result.error);
    return result.data.url;
  }, [conversationId, messageId]);

  if (expired) return <span className={styles.voiceExpired}><AlertCircle aria-hidden="true" /> Recording expired</span>;
  return <VoiceAudioPlayer key={`${conversationId}:${messageId}`} source={source} durationMs={durationMs} />;
}
