"use client";

import { ChevronLeft, Clock, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  teamSlowModeMaxSeconds,
  type TeamSlowModeScope,
} from "../../domain/team/schema";
import { formatSlowModeSeconds } from "./team-conversation-controls";
import { useExitTransition } from "./use-exit-transition";
import styles from "./team-messages.module.css";

const quickSlowModeOptions: { seconds: number; label: string }[] = [
  { seconds: 30, label: "30 seconds" },
  { seconds: 60, label: "1 minute" },
  { seconds: 300, label: "5 minutes" },
];

/**
 * The quick-access Slow Mode control: a clock icon in the conversation
 * header, replacing the large Conversation settings form as the PRIMARY
 * place Slow Mode is turned on, modified, or stopped. Conversation settings
 * keeps only a secondary status line and the (unrelated) enforcement-scope
 * choice — see `TeamConversationControls`.
 *
 * Only rendered by the caller when `capabilities.canManageSlowMode` is true:
 * a non-authorized member already sees Slow Mode's status in the header
 * subtitle line, and this component's whole reason to exist is to be an
 * ACTIONABLE control, so there is nothing correct for it to render for them.
 */
export function TeamSlowModeControl({
  active,
  seconds,
  scope,
  onSetSlowMode,
}: {
  active: boolean;
  seconds: number | null;
  scope: TeamSlowModeScope;
  onSetSlowMode: (seconds: number | null, scope: TeamSlowModeScope) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"root" | "picker">("root");
  const [customSeconds, setCustomSeconds] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const transition = useExitTransition(open, 160);

  /*
   * Closed state resets on render rather than in an effect — the same idiom
   * `TeamConversationControls` uses: a pure function of `open`, settling
   * after one write, never a subscription to anything external.
   */
  if (!open && (mode !== "root" || customSeconds !== "" || error !== null)) {
    setMode("root");
    setCustomSeconds("");
    setError(null);
  }

  useEffect(() => {
    if (!open) return;

    function outside(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    }

    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, { capture: true });
    };
  }, [open]);

  async function apply(nextSeconds: number | null) {
    setBusy(true);
    setError(null);
    const nextError = await onSetSlowMode(nextSeconds, scope);
    setBusy(false);
    if (nextError) {
      setError(nextError);
      return;
    }
    setOpen(false);
  }

  const validCustom = isValidCustomSlowModeSeconds(customSeconds);

  return (
    <div ref={rootRef} className={styles.slowModeAnchor}>
      <button
        type="button"
        className={[styles.iconButton, active ? styles.iconButtonActive : ""]
          .filter(Boolean)
          .join(" ")}
        aria-label="Slow Mode"
        aria-haspopup="menu"
        aria-expanded={open}
        title={active ? `Slow Mode · ${formatSlowModeSeconds(seconds!)}` : "Slow Mode"}
        onClick={() => setOpen((value) => !value)}
      >
        <Clock aria-hidden="true" />
      </button>

      {transition.render ? (
        <div
          role="menu"
          aria-label="Slow Mode"
          className={[
            styles.slowModeMenu,
            transition.phase === "closing" ? styles.slowModeMenuClosing : styles.slowModeMenuOpen,
          ].join(" ")}
        >
          {!active ? (
            <>
              <p className={styles.slowModeMenuLabel}>Turn on Slow Mode</p>
              {mode === "root" ? (
                <>
                  {quickSlowModeOptions.map((option) => (
                    <button
                      key={option.seconds}
                      type="button"
                      role="menuitem"
                      className={styles.slowModeMenuItem}
                      disabled={busy}
                      onClick={() => void apply(option.seconds)}
                    >
                      {option.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.slowModeMenuItem}
                    disabled={busy}
                    onClick={() => setMode("picker")}
                  >
                    Custom…
                  </button>
                </>
              ) : (
                <CustomSecondsForm
                  value={customSeconds}
                  onChange={setCustomSeconds}
                  disabled={busy}
                  valid={validCustom}
                  onBack={() => setMode("root")}
                  onSubmit={() => void apply(Number(customSeconds))}
                />
              )}
            </>
          ) : mode === "root" ? (
            <>
              <p className={styles.slowModeMenuLabel}>
                Slow Mode · {formatSlowModeSeconds(seconds!)}
              </p>
              <button
                type="button"
                role="menuitem"
                className={styles.slowModeMenuItem}
                disabled={busy}
                onClick={() => setMode("picker")}
              >
                Modify
              </button>
              <button
                type="button"
                role="menuitem"
                className={[styles.slowModeMenuItem, styles.slowModeMenuItemDanger].join(" ")}
                disabled={busy}
                onClick={() => void apply(null)}
              >
                Stop
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={styles.slowModeBack}
                onClick={() => setMode("root")}
              >
                <ChevronLeft aria-hidden="true" />
                Back
              </button>
              {quickSlowModeOptions.map((option) => (
                <button
                  key={option.seconds}
                  type="button"
                  role="menuitem"
                  className={styles.slowModeMenuItem}
                  disabled={busy}
                  onClick={() => void apply(option.seconds)}
                >
                  {option.label}
                </button>
              ))}
              <CustomSecondsForm
                value={customSeconds}
                onChange={setCustomSeconds}
                disabled={busy}
                valid={validCustom}
                onSubmit={() => void apply(Number(customSeconds))}
              />
            </>
          )}

          {busy ? (
            <div className={styles.controlsBusyRow} aria-live="polite">
              <Loader2 className={styles.spin} aria-hidden="true" size={13} />
            </div>
          ) : null}
          {error ? (
            <p className={styles.messageActionError} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CustomSecondsForm({
  value,
  onChange,
  disabled,
  valid,
  onBack,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  valid: boolean;
  onBack?: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      {onBack ? (
        <button type="button" className={styles.slowModeBack} onClick={onBack}>
          <ChevronLeft aria-hidden="true" />
          Back
        </button>
      ) : null}
      <div className={styles.slowModeCustomRow}>
        <input
          className={styles.controlsTextInput}
          type="number"
          min={1}
          max={teamSlowModeMaxSeconds}
          placeholder="Seconds"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && valid) onSubmit();
          }}
          aria-label="Custom Slow Mode seconds"
        />
        <button
          type="button"
          className={styles.controlsSmallButton}
          disabled={disabled || !valid}
          onClick={onSubmit}
        >
          Set
        </button>
      </div>
    </>
  );
}

function isValidCustomSlowModeSeconds(value: string): boolean {
  if (value.trim() === "") return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= teamSlowModeMaxSeconds;
}
