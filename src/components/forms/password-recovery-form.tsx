"use client";

import { useState, type FormEvent } from "react";
import { requestRecoveryCode, finishPasswordRecovery } from "../../app/actions/password-recovery";

export function PasswordRecoveryForm({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = step === "email" ? await requestRecoveryCode(form) : await finishPasswordRecovery(form);
      setMessage(result.message);
      if (result.ok) setStep(step === "email" ? "code" : "done");
    } catch {
      setMessage("The request could not be confirmed. Please try signing in or request a new code.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="login-form" onSubmit={submit} aria-label="Reset your password">
      <h2>Reset your password</h2>
      <div role="status">{message}</div>
      {step === "email" && <label>Registered SPP email<input name="email" type="email" autoFocus autoComplete="email" maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} required /></label>}
      {step === "code" && <>
        <input type="hidden" name="email" value={email} />
        <label>Verification code for {email}<input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus pattern="[0-9]{6}" maxLength={6} required /></label>
        <label>New password<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
        <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" minLength={8} required /></label>
      </>}
      {step !== "done" && <button className="button-primary login-submit" disabled={busy}>{step === "email" ? "Send verification code" : "Reset password"}</button>}
      {step === "code" && <button type="button" className="button-secondary" disabled={busy} onClick={() => { setMessage(""); setStep("email"); }}>Request another code</button>}
      <button type="button" className="button-secondary" disabled={busy} onClick={onBack}>Back to sign in</button>
    </form>
  );
}
