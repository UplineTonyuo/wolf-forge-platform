"use client";

import {
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  UserRoundPlus,
} from "lucide-react";
import Link from "next/link";
import {
  useActionState,
  useState,
} from "react";
import {
  useFormStatus,
} from "react-dom";
import {
  provisionClientAccountAction,
  type ProvisionClientAccountState,
} from "../../app/actions/client-account-provisioning";
import { ACTIVATION_LINK_DAYS } from "../../lib/email/client-welcome-email";
import styles from "./create-client-account-form.module.css";

function SubmitButton() {
  const { pending } =
    useFormStatus();

  return (
    <button
      className={styles.submit}
      disabled={pending}
      aria-busy={pending || undefined}
      type="submit"
    >
      {pending ? (
        <LoaderCircle
          className={styles.spinner}
          aria-hidden="true"
        />
      ) : (
        <UserRoundPlus
          aria-hidden="true"
        />
      )}

      {pending
        ? "Creating client..."
        : "Create Client"}
    </button>
  );
}

function FieldError({
  children,
}: {
  children?: string;
}) {
  if (!children) {
    return null;
  }

  return (
    <p
      className={styles.fieldError}
      role="alert"
    >
      {children}
    </p>
  );
}

export function CreateClientAccountForm({
  welcomeEmailAvailable,
}: {
  welcomeEmailAvailable: boolean;
}) {
  const [
    sendWelcomeEmail,
    setSendWelcomeEmail,
  ] = useState(
    welcomeEmailAvailable,
  );

  const [
    companyRequestId,
  ] = useState(
    () => crypto.randomUUID(),
  );

  const [
    contactRequestId,
  ] = useState(
    () => crypto.randomUUID(),
  );

  const initialState:
    ProvisionClientAccountState = {
      error: null,
      fieldErrors: {},
    };

  const [
    state,
    action,
  ] = useActionState(
    provisionClientAccountAction,
    initialState,
  );

  return (
    <div
      className={styles.shell}
    >
      <header
        className={styles.header}
      >

        <h1>
          Add Client
        </h1>

        <p>
          Create a real client login,
          company record, and primary
          contact in one flow.
        </p>
      </header>

      <div
        className={styles.securityNote}
      >
        <ShieldCheck
          aria-hidden="true"
        />

        <div>
          <strong>
            Secure provisioning
          </strong>

          <span>
            The login is created through
            the server-only Supabase
            admin boundary. Passwords are
            never stored in Wolf Forge
            business tables.
          </span>
        </div>
      </div>

      <form
        action={action}
        className={styles.form}
      >
        <input
          type="hidden"
          name="company_request_id"
          value={companyRequestId}
        />

        <input
          type="hidden"
          name="contact_request_id"
          value={contactRequestId}
        />

        {state.error ? (
          <div
            className={styles.banner}
            role="alert"
          >
            {state.error}
          </div>
        ) : null}

        <div
          className={styles.field}
        >
          <label htmlFor="client-email">
            Email
          </label>

          <input
            id="client-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={320}
            required
            aria-invalid={
              Boolean(
                state.fieldErrors.email,
              )
            }
          />

          <FieldError>
            {
              state.fieldErrors.email
            }
          </FieldError>
        </div>

        <div
          className={styles.grid}
        >
          <div
            className={styles.field}
          >
            <label htmlFor="client-first-name">
              First name
              <span>
                optional
              </span>
            </label>

            <input
              id="client-first-name"
              name="first_name"
              autoComplete="given-name"
              maxLength={100}
            />

            <FieldError>
              {
                state.fieldErrors
                  .firstName
              }
            </FieldError>
          </div>

          <div
            className={styles.field}
          >
            <label htmlFor="client-last-name">
              Last name
              <span>
                optional
              </span>
            </label>

            <input
              id="client-last-name"
              name="last_name"
              autoComplete="family-name"
              maxLength={100}
            />

            <FieldError>
              {
                state.fieldErrors
                  .lastName
              }
            </FieldError>
          </div>
        </div>

        <div
          className={styles.field}
        >
          <label htmlFor="client-company">
            Company
          </label>

          <input
            id="client-company"
            name="company"
            autoComplete="organization"
            maxLength={200}
            required
            aria-invalid={
              Boolean(
                state.fieldErrors.company,
              )
            }
          />

          <FieldError>
            {
              state.fieldErrors.company
            }
          </FieldError>
        </div>

        <div
          className={styles.grid}
        >
          <div
            className={styles.field}
          >
            <label htmlFor="client-phone">
              Phone
              <span>
                optional
              </span>
            </label>

            <input
              id="client-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={50}
            />

            <FieldError>
              {
                state.fieldErrors.phone
              }
            </FieldError>
          </div>

          <div
            className={styles.field}
          >
            <label htmlFor="client-job-title">
              Job title
              <span>
                optional
              </span>
            </label>

            <input
              id="client-job-title"
              name="job_title"
              autoComplete="organization-title"
              maxLength={120}
            />

            <FieldError>
              {
                state.fieldErrors
                  .jobTitle
              }
            </FieldError>
          </div>
        </div>

        <label
          className={styles.welcomeOption}
        >
          <input
            type="checkbox"
            name="send_welcome_email"
            checked={sendWelcomeEmail}
            disabled={!welcomeEmailAvailable}
            onChange={(event) =>
              setSendWelcomeEmail(
                event.target.checked,
              )
            }
          />

          <span>
            <strong>
              Email a secure set-password link
            </strong>

            <span>
              {welcomeEmailAvailable
                ? `The client chooses their own password from a single-use link that expires in ${ACTIVATION_LINK_DAYS} days. No password is emailed.`
                : "Needs a connected Gmail account (Settings > Integrations) and integrations access."}
            </span>
          </span>
        </label>

        {sendWelcomeEmail ? null : (
        <div
          className={styles.passwordSection}
        >
          <div
            className={styles.passwordHeading}
          >
            <KeyRound
              aria-hidden="true"
            />

            <div>
              <strong>
                Temporary login
              </strong>

              <span>
                Give this password to the
                client securely. Client
                portal routing is the next
                implementation phase.
              </span>
            </div>
          </div>

          <div
            className={styles.grid}
          >
            <div
              className={styles.field}
            >
              <label htmlFor="client-temporary-password">
                Temporary password
              </label>

              <input
                id="client-temporary-password"
                name="temporary_password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                required
              />

              <FieldError>
                {
                  state.fieldErrors
                    .password
                }
              </FieldError>
            </div>

            <div
              className={styles.field}
            >
              <label htmlFor="client-confirm-password">
                Confirm password
              </label>

              <input
                id="client-confirm-password"
                name="confirm_password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                required
              />

              <FieldError>
                {
                  state.fieldErrors
                    .confirmPassword
                }
              </FieldError>
            </div>
          </div>
        </div>
        )}

        <div
          className={styles.actions}
        >
          <Link
            href="/clients"
            className={styles.cancel}
          >
            Cancel
          </Link>

          <SubmitButton />
        </div>
      </form>
    </div>
  );
}