"use client";

import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { signInAction, type LoginState } from "../../app/actions/auth";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="button-primary login-submit" disabled={pending}>{pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}Sign in</button>;
}

export function LoginForm({ next = "/", initialError = null }: { next?: string; initialError?: string | null }) {
  const initialState: LoginState = { error: initialError };
  const [state, action] = useActionState(signInAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={action} className="login-form">
      <input type="hidden" name="next" value={next} />
      {state.error ? <div className="form-banner" role="alert">{state.error}</div> : null}
      <label>Email<input name="email" type="email" autoComplete="username" autoFocus required /></label>
      <label>Password
        <span className="password-field">
          <input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required />
          <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>
            {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        </span>
      </label>
      <SubmitButton />
    </form>
  );
}
