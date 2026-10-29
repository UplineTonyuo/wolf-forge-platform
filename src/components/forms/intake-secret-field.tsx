"use client";

import { useState } from "react";
import styles from "./intake-secret-field.module.css";

export function IntakeSecretField({ id, label, value, saved, required, disabled, describedBy, error, onChange }: {
  id: string; label: string; value: string; saved: boolean; required: boolean; disabled: boolean;
  describedBy?: string; error?: string; onChange: (value: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const visible = shown && Boolean(value);
  return <div className={styles.root}>
    <div className={styles.control}>
      <input id={id} type={visible ? "text" : "password"} autoComplete="new-password" autoCapitalize="none" spellCheck={false} value={value}
        maxLength={4096} required={required && !saved} disabled={disabled}
        placeholder={saved ? "Enter a new password to replace it" : undefined}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={[describedBy, `${id}-saved`, error ? `${id}-error` : undefined].filter(Boolean).join(" ")}
        onChange={(event) => { if (!value) setShown(false); onChange(event.currentTarget.value); }} />
      <button type="button" disabled={disabled || !value} aria-label={`${visible ? "Hide" : "Show"} ${label}`}
        aria-pressed={visible} onClick={() => setShown((current) => !current)}>{visible ? "Hide" : "Show"}</button>
    </div>
    <p id={`${id}-saved`} role="status">{saved ? "Password saved securely." : "This password will be encrypted when you save or submit."}</p>
    {error ? <p id={`${id}-error`} className={styles.error} role="alert">{error}</p> : null}
  </div>;
}
