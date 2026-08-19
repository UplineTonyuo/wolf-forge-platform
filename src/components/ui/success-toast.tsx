"use client";

import { Check, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./success-toast.module.css";

/** How long the toast stays up before dismissing itself. */
const AUTO_DISMISS_MS = 3600;

/**
 * How long the exit transition runs. Must stay in step with the closing-state
 * `transition-duration` in success-toast.module.css.
 */
const EXIT_MS = 140;

/** `closing` is the toast animating out — mounted, but on its way to removal. */
type ToastPhase = "open" | "closing" | "closed";

/**
 * Compact confirmation for a completed action.
 *
 * It mounts already open and `@starting-style` supplies the frame it grows
 * from, so no state has to be flipped after mount to play the entrance. The
 * region wrapper stays mounted for the whole page life so the live-region
 * announcement fires when the toast is inserted into it.
 */
export function SuccessToast({
  title,
  detail,
}: {
  title: string;
  /** Optional supporting line, e.g. what the action preserved. */
  detail?: string;
}) {
  const [phase, setPhase] = useState<ToastPhase>("open");
  const removeTimerRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    setPhase((current) => (current === "open" ? "closing" : current));

    if (removeTimerRef.current !== null) {
      window.clearTimeout(removeTimerRef.current);
    }

    removeTimerRef.current = window.setTimeout(() => {
      removeTimerRef.current = null;
      setPhase((current) => (current === "closing" ? "closed" : current));
    }, EXIT_MS);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [dismiss]);

  useEffect(() => () => {
    if (removeTimerRef.current !== null) {
      window.clearTimeout(removeTimerRef.current);
    }
  }, []);

  return (
    <div className={styles.region} role="status" aria-live="polite">
      {phase === "closed" ? null : (
        <div className={styles.toast} data-state={phase}>
          <span className={styles.icon} aria-hidden="true">
            <Check />
          </span>

          <span className={styles.copy}>
            <strong>{title}</strong>
            {detail ? <span>{detail}</span> : null}
          </span>

          <button
            type="button"
            className={styles.dismiss}
            aria-label="Dismiss notification"
            onClick={dismiss}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
