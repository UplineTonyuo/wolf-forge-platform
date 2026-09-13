"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { changeMyPasswordAction } from "../../app/actions/security";
import {
  initialPasswordActionState,
  MIN_PASSWORD_LENGTH,
} from "../../domain/profile/security";
import styles from "./password-dialog.module.css";

type FieldName = "current_password" | "new_password" | "confirm_password";

const FIELDS: Array<{ name: FieldName; label: string; autoComplete: string }> = [
  { name: "current_password", label: "Current password", autoComplete: "current-password" },
  { name: "new_password", label: "New password", autoComplete: "new-password" },
  { name: "confirm_password", label: "Confirm new password", autoComplete: "new-password" },
];

/**
 * A password field with a reveal toggle.
 *
 * The value stays uncontrolled so React never holds a password in state; the
 * form is reset whenever the dialog closes, so nothing survives the interaction.
 */
function PasswordField({
  name,
  label,
  autoComplete,
  error,
  disabled,
  inputRef,
}: {
  name: FieldName;
  label: string;
  autoComplete: string;
  error?: string;
  disabled: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const fieldId = useId();
  const errorId = useId();
  const [revealed, setRevealed] = useState(false);

  return (
    <div className={styles.field}>
      <label htmlFor={fieldId}>{label}</label>

      <div className={styles.inputRow}>
        <input
          ref={inputRef}
          id={fieldId}
          name={name}
          type={revealed ? "text" : "password"}
          autoComplete={autoComplete}
          required
          disabled={disabled}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : undefined}
        />

        <button
          type="button"
          className={styles.reveal}
          aria-label={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={revealed}
          onClick={() => setRevealed((value) => !value)}
        >
          {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>

      {error ? (
        <span className={styles.fieldError} id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Change-password dialog.
 *
 * All verification and the change itself happen in the server action against
 * Supabase Auth. This component validates nothing security-relevant on its own
 * beyond keeping the form honest, and it never retains a password value.
 */
export function PasswordDialog({
  isOpen,
  onClose,
  onChanged,
}: {
  /** Drives the open/closed visual state; the caller owns mount/unmount. */
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [state, submit, pending] = useActionState(
    changeMyPasswordAction,
    initialPasswordActionState,
  );

  const titleId = useId();
  const descriptionId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const acknowledgedChangeRef = useRef<string | null>(null);

  const closeDialog = useCallback(() => {
    /* Nothing typed survives the close. */
    formRef.current?.reset();
    onClose();
  }, [onClose]);

  /* Move focus into the dialog once it is mounted and open. */
  useEffect(() => {
    if (isOpen) firstFieldRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      /* A change in flight is not interrupted by Escape. */
      if (event.key !== "Escape" || pending) return;

      event.preventDefault();
      closeDialog();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDialog, pending]);

  /*
   * A new `changedAt` means the action succeeded. The ref keeps this from
   * re-firing, and the reset clears the fields before the dialog unmounts.
   */
  useEffect(() => {
    if (!state.changedAt || acknowledgedChangeRef.current === state.changedAt) return;
    acknowledgedChangeRef.current = state.changedAt;
    formRef.current?.reset();
    onClose();
    onChanged();
  }, [onChanged, onClose, state.changedAt]);

  const dialog = (
    <div
      className={[
        styles.backdrop,
        isOpen ? styles.backdropOpen : styles.backdropClosing,
      ].join(" ")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) closeDialog();
      }}
    >
      <div
        className={[styles.panel, isOpen ? styles.panelOpen : styles.panelClosing].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className={styles.header}>
          <h2 id={titleId}>Change password</h2>
          <p id={descriptionId}>
            Enter your current password, then choose a new one. Other devices
            will be signed out.
          </p>
        </div>

        <form ref={formRef} action={submit}>
          <div className={styles.fields}>
            {FIELDS.map((field, index) => (
              <PasswordField
                key={field.name}
                name={field.name}
                label={field.label}
                autoComplete={field.autoComplete}
                error={state.fieldErrors[field.name]}
                disabled={pending}
                inputRef={index === 0 ? firstFieldRef : undefined}
              />
            ))}
          </div>

          {state.error ? (
            <p className={styles.formError} role="alert">
              {state.error}
            </p>
          ) : (
            <p className={styles.hint}>
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          )}

          <div className={styles.footer}>
            <button
              type="button"
              className={styles.secondary}
              onClick={closeDialog}
              disabled={pending}
            >
              Cancel
            </button>

            <button type="submit" className={styles.primary} aria-busy={pending || undefined} disabled={pending}>
              {pending ? <Loader2 aria-hidden="true" /> : null}
              {pending ? "Updating" : "Update password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(dialog, document.body)
    : null;
}
