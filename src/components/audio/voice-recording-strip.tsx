"use client";

import { Square, Trash2 } from "lucide-react";
import { voiceClock } from "./voice-audio-player";
import styles from "./voice-audio.module.css";

export function VoiceRecordingStrip({ elapsedMs, limitMs, onStop, onCancel, cancelLabel = "Discard recording" }: {
  elapsedMs: number;
  limitMs: number;
  onStop: () => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  return <div className={styles.recording}>
    <span className={styles.recordingLabel} role="status" aria-label="Recording voice message"><span className={styles.dot} aria-hidden="true" />Recording</span>
    <span className={styles.recordingTime} role="timer" aria-label="Recording duration">{voiceClock(elapsedMs)} / {voiceClock(limitMs)}</span>
    <button type="button" className={styles.stop} onClick={onStop} aria-label="Stop recording"><Square aria-hidden="true" /><span>Stop</span></button>
    <button type="button" className={styles.cancel} onClick={onCancel} aria-label={cancelLabel}><Trash2 aria-hidden="true" /></button>
  </div>;
}
