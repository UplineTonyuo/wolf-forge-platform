"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import {
  createCompanyAction,
  type CreateCompanyState,
} from "../../app/actions/clients";

const initialState: CreateCompanyState = {
  error: null,
  fieldError: null,
  duplicate: null,
};

export function CreateCompanyForm() {
  const [requestId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(
    createCompanyAction,
    initialState,
  );

  return (
    <form action={action} className="add-account-form">
      <input type="hidden" name="request_id" value={requestId} />

      {state.error ? (
        <div className="form-banner" role="alert">
          {state.error}
        </div>
      ) : null}

      {state.duplicate ? (
        <div className="form-banner" role="alert">
          A company named {state.duplicate.name} already exists.{" "}
          <Link href={`/clients/${state.duplicate.id}`}>
            Open the existing company.
          </Link>
        </div>
      ) : null}

      <div className="add-account-field add-account-field-full">
        <label htmlFor="company-name">Company name</label>
        <input
          id="company-name"
          name="name"
          autoComplete="organization"
          maxLength={200}
          required
          aria-invalid={Boolean(state.fieldError)}
          aria-describedby={state.fieldError ? "company-name-error" : undefined}
        />

        {state.fieldError ? (
          <p id="company-name-error" className="field-error">
            {state.fieldError}
          </p>
        ) : null}
      </div>

      <div className="add-account-actions">
        <Link className="button-secondary" href="/clients">
          Cancel
        </Link>
        <button
          className="button-primary"
          disabled={pending}
          aria-busy={pending || undefined}
          type="submit"
        >
          {pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}
          Create company
        </button>
      </div>
    </form>
  );
}
