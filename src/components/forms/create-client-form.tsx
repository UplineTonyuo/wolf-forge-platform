"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createClientAction,
  type CreateClientState,
} from "../../app/actions/clients";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="button-primary add-account-submit"
      disabled={pending}
      type="submit"
    >
      {pending ? (
        <LoaderCircle
          className="spinner"
          aria-hidden="true"
        />
      ) : null}

      Add account
    </button>
  );
}

export function CreateClientForm() {
  const [requestId] = useState(() => crypto.randomUUID());

  const initialState: CreateClientState = {
    error: null,
    fieldError: null,
  };

  const [state, action] = useActionState(
    createClientAction,
    initialState,
  );

  return (
    <form
      action={action}
      className="add-account-form"
    >
      <input
        type="hidden"
        name="request_id"
        value={requestId}
      />

      {state.error ? (
        <div
          className="form-banner"
          role="alert"
        >
          {state.error}
        </div>
      ) : null}

      <div className="add-account-field add-account-field-full">
        <label htmlFor="account-email">
          Email
        </label>

        <input
          id="account-email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={320}
        />
      </div>

      <div className="add-account-grid">
        <div className="add-account-field">
          <label htmlFor="account-first-name">
            First name
            <span>optional</span>
          </label>

          <input
            id="account-first-name"
            name="first_name"
            autoComplete="given-name"
            maxLength={100}
          />
        </div>

        <div className="add-account-field">
          <label htmlFor="account-last-name">
            Last name
            <span>optional</span>
          </label>

          <input
            id="account-last-name"
            name="last_name"
            autoComplete="family-name"
            maxLength={100}
          />
        </div>
      </div>

      <div className="add-account-field add-account-field-full">
        <label htmlFor="account-company">
          Company
        </label>

        <input
          id="account-company"
          name="name"
          autoComplete="organization"
          maxLength={200}
          required
          aria-invalid={Boolean(state.fieldError)}
          aria-describedby={
            state.fieldError
              ? "account-company-error"
              : undefined
          }
        />

        {state.fieldError ? (
          <p
            id="account-company-error"
            className="field-error"
          >
            {state.fieldError}
          </p>
        ) : null}
      </div>

      <div className="add-account-grid">
        <div className="add-account-field">
          <label htmlFor="account-phone">
            Phone
            <span>optional</span>
          </label>

          <input
            id="account-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            maxLength={50}
          />
        </div>

        <div className="add-account-field">
          <label htmlFor="account-job-title">
            Job title
            <span>optional</span>
          </label>

          <input
            id="account-job-title"
            name="job_title"
            autoComplete="organization-title"
            maxLength={120}
          />
        </div>
      </div>

      <div className="add-account-actions">
        <Link
          className="button-secondary"
          href="/clients"
        >
          Cancel
        </Link>

        <SubmitButton />
      </div>
    </form>
  );
}
