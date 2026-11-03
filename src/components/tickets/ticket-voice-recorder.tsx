"use client";

import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TICKET_ATTACHMENT_MAX_BYTES, TICKET_AUDIO_MAX_DURATION_MS } from "../../lib/tickets/ticket-attachment-file";
import styles from "./ticket-voice-recorder.module.css";
import { VoiceRecordingStrip } from "../audio/voice-recording-strip";

export function TicketVoiceRecorder({ ticketId, disabled, onPickAttachment, onRecordingChange }: {
  ticketId: string;
  disabled: boolean;
  onPickAttachment: (file: File, durationMs: number) => void;
  onRecordingChange: (recording: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const permissionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(false);
  const generationRef = useRef(0);
  const discardRef = useRef(false);
  const pickRef = useRef(onPickAttachment);
  const recordingChangeRef = useRef(onRecordingChange);
  useEffect(() => { pickRef.current = onPickAttachment; recordingChangeRef.current = onRecordingChange; }, [onPickAttachment, onRecordingChange]);

  function releaseMicrophone() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (permissionTimerRef.current) clearTimeout(permissionTimerRef.current);
    permissionTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    streamRef.current = null;
  }

  function invalidateRequest() { return ++generationRef.current; }

  useEffect(() => {
    aliveRef.current = true;
    const supported = typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function" &&
      typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" &&
      ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"].some((type) => MediaRecorder.isTypeSupported(type));
    queueMicrotask(() => { if (aliveRef.current) setEnabled(supported); });
    return () => {
      aliveRef.current = false;
      invalidateRequest();
      discardRef.current = true;
      const recorder = recorderRef.current;
      if (recorder?.state === "recording") recorder.stop();
      releaseMicrophone();
      recordingChangeRef.current(false);
    };
  }, [ticketId]);

  useEffect(() => {
    if (!disabled) return;
    const generation = invalidateRequest();
    discardRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    releaseMicrophone();
    recordingChangeRef.current(false);
    queueMicrotask(() => {
      if (!aliveRef.current || generation !== generationRef.current) return;
      setRequesting(false);
      setRecording(false);
    });
  }, [disabled]);

  function cancel() {
    invalidateRequest();
    discardRef.current = true;
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    releaseMicrophone();
    setRequesting(false);
    setRecording(false);
    recordingChangeRef.current(false);
  }

  async function start() {
    if (disabled || requesting || recording) return;
    const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) { setError("This browser cannot record a supported voice format."); return; }
    const generation = ++generationRef.current;
    setError(null);
    setRequesting(true);
    recordingChangeRef.current(true);
    let stream: MediaStream | null = null;
    const permissionTimer = setTimeout(() => {
      if (!aliveRef.current || generation !== generationRef.current) return;
      invalidateRequest();
      releaseMicrophone();
      setRequesting(false);
      recordingChangeRef.current(false);
      setError("Microphone access is taking too long. Check your browser permission, then try again.");
    }, 30_000);
    permissionTimerRef.current = permissionTimer;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      clearTimeout(permissionTimer);
      if (permissionTimerRef.current === permissionTimer) permissionTimerRef.current = null;
      if (!aliveRef.current || generation !== generationRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 });
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      let size = 0;
      const started = performance.now();
      discardRef.current = false;
      recorder.ondataavailable = (event) => {
        if (!aliveRef.current || generation !== generationRef.current) return;
        if (!event.data.size) return;
        size += event.data.size;
        if (size > TICKET_ATTACHMENT_MAX_BYTES) {
          discardRef.current = true;
          if (aliveRef.current) setError("Recording exceeded 5 MB. Please make a shorter recording.");
          if (recorder.state === "recording") recorder.stop();
        } else chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (!aliveRef.current || generation !== generationRef.current) return;
        releaseMicrophone();
        setRecording(false);
        recordingChangeRef.current(false);
        if (discardRef.current || !size || size > TICKET_ATTACHMENT_MAX_BYTES) return;
        const type = recorder.mimeType.split(";")[0];
        const extension = type === "audio/ogg" ? "ogg" : "webm";
        pickRef.current(new File(chunks, `voice-${Date.now()}.${extension}`, { type }), Math.min(TICKET_AUDIO_MAX_DURATION_MS, Math.max(1, Math.round(performance.now() - started))));
      };
      const deviceLost = () => {
        if (!aliveRef.current || generation !== generationRef.current) return;
        discardRef.current = true;
        if (aliveRef.current) setError("Microphone disconnected. Please record again.");
        if (recorder.state === "recording") recorder.stop();
        releaseMicrophone();
      };
      recorder.onerror = deviceLost;
      stream.getAudioTracks().forEach((track) => { track.onended = deviceLost; });
      setElapsed(0);
      setRequesting(false);
      setRecording(true);
      recorder.start(1000);
      timerRef.current = setInterval(() => {
        const duration = performance.now() - started;
        if (aliveRef.current) setElapsed(Math.min(duration, TICKET_AUDIO_MAX_DURATION_MS));
        if (duration >= TICKET_AUDIO_MAX_DURATION_MS && recorder.state === "recording") recorder.stop();
      }, 250);
    } catch (failure) {
      clearTimeout(permissionTimer);
      if (permissionTimerRef.current === permissionTimer) permissionTimerRef.current = null;
      stream?.getTracks().forEach((track) => track.stop());
      if (!aliveRef.current || generation !== generationRef.current) return;
      releaseMicrophone();
      setRequesting(false);
      setRecording(false);
      recordingChangeRef.current(false);
      setError(failure instanceof DOMException && failure.name === "NotAllowedError"
        ? "Microphone access was denied. Allow it in your browser settings to record."
        : "Could not access a microphone. Connect one and try again.");
    }
  }

  if (!enabled) return null;
  return <div className={styles.recorder} data-recording={recording || requesting || undefined}>
    {recording ? <VoiceRecordingStrip elapsedMs={elapsed} limitMs={TICKET_AUDIO_MAX_DURATION_MS}
      onStop={() => { if (recorderRef.current?.state === "recording") recorderRef.current.stop(); }} onCancel={cancel} /> : requesting ? <>
      <span role="status">Waiting for microphone…</span>
      <button type="button" onClick={cancel}>Cancel recording</button>
    </> : <button type="button" onClick={() => void start()} disabled={disabled} aria-label="Record voice message" title="Record voice message"><Mic aria-hidden="true" /></button>}
    {error ? <span role="alert" className={styles.error}>{error}</span> : null}
  </div>;
}
