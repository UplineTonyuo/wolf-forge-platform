"use client";

import { Loader2, Mic, MicOff } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useClientMounted, useExitTransition } from "./use-exit-transition";
import styles from "./team-messages.module.css";

export type MicDialogKind = "intro" | "blocked" | "no-device" | "busy" | "disconnected" | "unavailable";

const MIC_DIALOG_COPY: Record<Exclude<MicDialogKind, "intro">, { title: string; body: string }> = {
  blocked: {
    title: "Microphone is blocked",
    body: "Wolf Forge can't record a voice message until microphone access is allowed for this site. Open your browser's site settings, allow the microphone for Wolf Forge, then try again.",
  },
  "no-device": {
    title: "No microphone detected",
    body: "Connect a microphone, headset, or another audio input device and try again.",
  },
  busy: {
    title: "Microphone is unavailable",
    body: "The microphone may be in use by another application. Close it and try again.",
  },
  disconnected: {
    title: "Microphone disconnected",
    body: "The recording was stopped because the microphone became unavailable.",
  },
  unavailable: {
    title: "Microphone is unavailable",
    body: "Something went wrong accessing the microphone. Try again.",
  },
};

/**
 * One dialog, five voices.
 *
 * The intro ask ("Use microphone") is the only kind with two actions, because
 * it is the only kind that can still go either way — every other kind is a
 * report of something that already happened (blocked, missing, busy,
 * disconnected), so it only ever needs an acknowledgement. Keeping them one
 * component means the centered/compact/focus-trapped shell is written once.
 */
export function TeamVoicePermissionDialog({
  kind,
  busy,
  onAllow,
  onClose,
  restoreFocusTo,
}: {
  kind: MicDialogKind | null;
  busy: boolean;
  onAllow: () => void;
  onClose: () => void;
  restoreFocusTo: React.RefObject<HTMLButtonElement | null>;
}) {
  const mounted = useClientMounted();
  const { render, phase } = useExitTransition(kind !== null, 160);
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const fieldId = useId();
  const wasOpenRef = useRef(false);

  /*
   * `kind` goes null the instant `onClose` fires, but the dialog itself stays
   * mounted for the exit animation (`render` lags behind by 160ms). Reading
   * `kind` directly for copy would blank the dialog mid-animation, so the
   * last non-null kind is kept around for exactly as long as `render` is
   * true. Same render-phase-derived-state shape `useExitTransition` itself
   * uses — a conditional `setState` during render, not a ref write.
   */
  const [displayKind, setDisplayKind] = useState<MicDialogKind | null>(kind);
  if (kind !== null && kind !== displayKind) setDisplayKind(kind);

  useEffect(() => {
    if (!render || phase !== "open") return;
    const timer = window.setTimeout(() => primaryRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [phase, render]);

  useEffect(() => {
    if (render) {
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      restoreFocusTo.current?.focus();
    }
  }, [render, restoreFocusTo]);

  /* Escape and outside clicks both only ever dismiss — never confirm — so an
   * accidental click near the dialog can never itself request the microphone. */
  useEffect(() => {
    if (!render) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, render]);

  if (!mounted || !render || !displayKind) return null;

  const closing = phase === "closing";
  const isIntro = displayKind === "intro";
  const copy = isIntro
    ? { title: "Use microphone", body: "Wolf Forge needs microphone access to record and send voice messages." }
    : MIC_DIALOG_COPY[displayKind];

  return createPortal(
    <div
      className={[styles.dialogBackdrop, closing ? styles.dialogBackdropClosing : styles.dialogBackdropOpen].join(" ")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${fieldId}-mic-heading`}
        className={[
          styles.dialog,
          styles.micDialog,
          closing ? styles.dialogClosing : styles.dialogOpen,
        ].join(" ")}
      >
        <div className={styles.micDialogIcon} aria-hidden="true">
          {isIntro ? <Mic /> : <MicOff />}
        </div>

        <div className={styles.dialogHeader}>
          <h3 id={`${fieldId}-mic-heading`}>{copy.title}</h3>
          <p>{copy.body}</p>
        </div>

        <div className={styles.dialogActions}>
          {isIntro ? (
            <>
              <button type="button" className={styles.secondaryButton} onClick={onClose}>
                Not now
              </button>
              <button
                ref={primaryRef}
                type="button"
                className={styles.primaryButton}
                aria-busy={busy || undefined}
                disabled={busy}
                onClick={onAllow}
              >
                {busy ? <Loader2 aria-hidden="true" className={styles.spin} /> : null}
                Allow microphone
              </button>
            </>
          ) : (
            <button ref={primaryRef} type="button" className={styles.primaryButton} onClick={onClose}>
              Got it
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
