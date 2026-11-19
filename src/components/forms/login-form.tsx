"use client";

import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { PasswordRecoveryForm } from "./password-recovery-form";
import { signInAction, type LoginState } from "../../app/actions/auth";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="button-primary login-submit" disabled={pending} aria-busy={pending || undefined}>{pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}Sign in</button>;
}

export function LoginForm({ next = "/", initialError = null }: { next?: string; initialError?: string | null }) {
  const initialState: LoginState = { error: initialError };
  const [state, action] = useActionState(signInAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [recovering, setRecovering] = useState(false);

  if (recovering) return <PasswordRecoveryForm initialEmail={email} onBack={() => setRecovering(false)} />;

  return (
    <form action={action} className="login-form">
      <input type="hidden" name="next" value={next} />
      {state.error ? <div className="form-banner" role="alert">{state.error}</div> : null}
      <label>Email<input name="email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password
        <span className="password-field">
          <input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required />
          <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>
            {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        </span>
      </label>
      <SubmitButton />
      <button className="button-secondary" type="button" onClick={() => setRecovering(true)}>Forgot password?</button>
    </form>
  );
}
