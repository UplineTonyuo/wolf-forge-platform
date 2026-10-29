"use client";

import { Loader2, Mic, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { teamVoiceMaxBytes, teamVoiceMaxDurationMs } from "../../domain/team/schema";
import {
  finalizeTeamVoiceUpload,
  prepareTeamVoiceUpload,
  uploadTeamVoiceBlob,
} from "./team-http-client";
import { TeamVoicePermissionDialog, type MicDialogKind } from "./team-voice-permission-dialog";
import { VoiceAudioPlayer } from "../audio/voice-audio-player";
import { VoiceRecordingStrip } from "../audio/voice-recording-strip";
import voiceStyles from "../audio/voice-audio.module.css";
import styles from "./team-messages.module.css";

const choices = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];

/*
 * Once getUserMedia has succeeded anywhere in this tab, later mic taps skip
 * the intro dialog even in browsers where the Permissions API can't confirm
 * "granted" (Safari has no microphone entry in navigator.permissions). It
 * resets on reload, which is fine — the browser's own permission is what
 * actually persists, this is only about not re-explaining ourselves.
 */
let microphoneGrantedOnce = false;

/** Test-only: each spec starts from "permission not yet proven this tab". */
export function __resetTeamVoiceRecorderPermissionMemory() {
  microphoneGrantedOnce = false;
}

function supportedMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return choices.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

function microphoneSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

// getUserMedia rejects with a DOMException whose `name` identifies the cause.
// Mapped to a dialog kind so the user never sees raw browser error text.
function microphoneErrorDialogKind(error: unknown): Exclude<MicDialogKind, "intro" | "disconnected"> {
  const name = error instanceof DOMException ? error.name : null;
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "blocked";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "no-device";
    case "NotReadableError":
    case "TrackStartError":
      return "busy";
    default:
      return "unavailable";
  }
}

export function TeamVoiceRecorder({
  conversationId,
  disabled,
  onSent,
}: {
  conversationId: string;
  disabled: boolean;
  onSent: () => void;
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const deviceLostRef = useRef(false);
  const micButtonRef = useRef<HTMLButtonElement>(null);
  const permissionStatusRef = useRef<PermissionStatus | null>(null);
  const aliveRef = useRef(false);
  const generationRef = useRef(0);
  const requestingRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<PermissionState | null>(null);
  const [dialogKind, setDialogKind] = useState<MicDialogKind | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const mimeType = supportedMimeType();
  const supported = mimeType !== null && microphoneSupported();

  // Read-only: querying current permission state never shows a browser
  // prompt, so this does not violate "no permission request on page load".
  useEffect(() => {
    if (!supported || typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((status) => {
        if (cancelled) return;
        permissionStatusRef.current = status;
        setPermissionState(status.state);
        status.onchange = () => setPermissionState(status.state);
      })
      .catch(() => {
        // Some browsers (Safari) reject an unrecognized permission name.
        // Permission state simply stays unknown and every tap falls back
        // to the intro dialog until a request has actually succeeded.
      });
    return () => {
      cancelled = true;
      if (permissionStatusRef.current) permissionStatusRef.current.onchange = null;
    };
  }, [supported]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const next = performance.now() - startedAtRef.current;
      setElapsed(Math.min(next, teamVoiceMaxDurationMs));
      if (next >= teamVoiceMaxDurationMs) recorderRef.current?.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    aliveRef.current = true;
    generationRef.current++;
    return () => {
      aliveRef.current = false;
      const recorder = recorderRef.current;
      if (recorder) { recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null; }
      if (recorder?.state === "recording") recorder.stop();
      streamRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    };
  }, []);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    if (!disabled) return;
    generationRef.current++;
    requestingRef.current = false;
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    streamRef.current = null;
    queueMicrotask(() => { if (aliveRef.current) { setRecording(false); setDialogBusy(false); setDialogKind(null); } });
  }, [disabled]);

  function discard() {
    generationRef.current++;
    requestingRef.current = false;
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    streamRef.current = null;
    setRecording(false);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setBlob(null);
    setElapsed(0);
    setError(null);
  }

  function stopForDeviceLoss() {
    deviceLostRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecording(false);
    setDialogKind("disconnected");
  }

  async function requestMicrophoneAndRecord() {
    if (!supported || busy || disabled || requestingRef.current) return;
    discard();
    const generation = ++generationRef.current;
    requestingRef.current = true;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!aliveRef.current || generation !== generationRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      const recordingStream = stream;
      microphoneGrantedOnce = true;
      setPermissionState("granted");
      setDialogKind(null);

      const recorder = new MediaRecorder(stream, { mimeType: mimeType! });
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      deviceLostRef.current = false;
      recorder.ondataavailable = (event) => {
        if (aliveRef.current && generation === generationRef.current && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        recordingStream.getTracks().forEach((track) => { track.onended = null; track.stop(); });
        if (!aliveRef.current || generation !== generationRef.current) return;
        streamRef.current = null;
        recorderRef.current = null;
        setElapsed(Math.min(teamVoiceMaxDurationMs, Math.max(1, Math.round(performance.now() - startedAtRef.current))));
        setRecording(false);
        if (deviceLostRef.current) {
          deviceLostRef.current = false;
          chunksRef.current = [];
          setDialogKind("disconnected");
          return;
        }
        const next = new Blob(chunksRef.current, { type: mimeType! });
        if (next.size > teamVoiceMaxBytes) {
          setError("Recording exceeds the 5 MB limit.");
          return;
        }
        setBlob(next);
        setPreviewUrl(URL.createObjectURL(next));
      };
      const deviceLost = () => { if (aliveRef.current && generation === generationRef.current) stopForDeviceLoss(); };
      recorder.onerror = deviceLost;
      stream.getAudioTracks().forEach((track) => {
        track.onended = deviceLost;
      });
      startedAtRef.current = performance.now();
      setElapsed(0);
      setRecording(true);
      recorder.start(1000);
    } catch (err) {
      stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
      if (!aliveRef.current || generation !== generationRef.current) return;
      streamRef.current = null;
      recorderRef.current = null;
      setRecording(false);
      const kind = microphoneErrorDialogKind(err);
      if (kind === "blocked") setPermissionState("denied");
      setDialogKind(kind);
    } finally {
      if (generation === generationRef.current) requestingRef.current = false;
    }
  }

  function handleMicButtonClick() {
    if (disabled || busy) return;
    // The Permissions API's microphone entry is not trustworthy on its own:
    // some browsers report "denied" when the site is actually allowed but no
    // audio-input device exists at all. Permission and hardware availability
    // are separate states, so "denied" (like "granted") only ever skips the
    // intro dialog here — the getUserMedia call it triggers, not the
    // Permissions API state, is what actually classifies the failure.
    if (permissionState === "granted" || permissionState === "denied" || microphoneGrantedOnce) {
      void requestMicrophoneAndRecord();
      return;
    }
    setDialogKind("intro");
  }

  async function handleAllowMicrophone() {
    setDialogBusy(true);
    await requestMicrophoneAndRecord();
    setDialogBusy(false);
  }

  async function send() {
    if (!blob || busy) return;
    setBusy(true);
    setError(null);
    const slot = await prepareTeamVoiceUpload({ conversationId, mimeType: blob.type });
    if (!slot.ok) { setError(slot.error); setBusy(false); return; }
    const uploaded = await uploadTeamVoiceBlob(slot.data.uploadUrl, blob);
    if (!uploaded.ok) { setError(uploaded.error); setBusy(false); return; }
    const finalized = await finalizeTeamVoiceUpload({
      uploadId: slot.data.uploadId,
      recordedDurationMs: Math.max(1, elapsed),
    });
    if (!finalized.ok) { setError(finalized.error); setBusy(false); return; }
    discard();
    setBusy(false);
    onSent();
  }

  if (!supported) return null;

  let content;
  if (recording) {
    content = (
      <VoiceRecordingStrip elapsedMs={elapsed} limitMs={teamVoiceMaxDurationMs} onStop={() => recorderRef.current?.stop()}
        onCancel={discard} cancelLabel="Discard voice recording" />
    );
  } else if (blob && previewUrl) {
    content = (
      <div className={`${styles.voiceRecorder} ${voiceStyles.review}`}>
        <VoiceAudioPlayer key={previewUrl} source={blob} durationMs={elapsed} label="voice recording preview" disabled={busy} />
        <button type="button" onClick={discard} disabled={busy} aria-label="Discard voice recording"><Trash2 aria-hidden="true" /></button>
        <button type="button" onClick={() => void send()} disabled={busy} aria-busy={busy || undefined} aria-label="Send voice message">
          {busy ? <Loader2 className={styles.spin} aria-hidden="true" /> : <Send aria-hidden="true" />}
        </button>
        {error ? <span className={styles.voiceError} role="alert">{error}</span> : null}
      </div>
    );
  } else {
    content = (
      <div className={styles.voiceRecorderButtonWrap}>
        <button
          ref={micButtonRef}
          type="button"
          className={styles.voiceMicButton}
          onClick={handleMicButtonClick}
          disabled={disabled || busy}
          aria-label="Record voice message"
          title="Record voice message"
        >
          <Mic aria-hidden="true" />
        </button>
        {error ? <span className={styles.voiceMicErrorPopover} role="alert">{error}</span> : null}
      </div>
    );
  }

  return (
    <>
      {content}
      <TeamVoicePermissionDialog
        kind={dialogKind}
        busy={dialogBusy}
        onAllow={() => void handleAllowMicrophone()}
        onClose={() => setDialogKind(null)}
        restoreFocusTo={micButtonRef}
      />
    </>
  );
}
