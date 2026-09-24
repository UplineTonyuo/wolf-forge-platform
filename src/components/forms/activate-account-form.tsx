"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import {
  activateAccountAction,
  type ActivateAccountState,
} from "../../app/actions/account-activation";

const initialState: ActivateAccountState = { error: null, done: false };

export function ActivateAccountForm() {
  const [state, dispatch, pending] = useActionState(activateAccountAction, initialState);

  if (state.done) {
    return (
      <div className="login-form">
        <div className="success-banner" role="status">Your password is set.</div>
        <Link className="button-primary login-submit" href="/login">Sign in</Link>
      </div>
    );
  }

  return (
    <form
      className="login-form"
      action={(formData) => {
        // The token lives in the URL fragment, which browsers never send to a server.
        formData.set("token", new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
        dispatch(formData);
      }}
    >
      {state.error ? <div className="form-banner" role="alert">{state.error}</div> : null}
      <label>New password<input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required autoFocus /></label>
      <label>Confirm password<input name="confirm_password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required /></label>
      <button className="button-primary login-submit" disabled={pending} aria-busy={pending || undefined}>
        {pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}
        Set password
      </button>
    </form>
  );
}
