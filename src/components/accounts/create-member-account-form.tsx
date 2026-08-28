"use client";

import { KeyRound, LoaderCircle, Shield, ShieldCheck, UserCog, UserRoundPlus, Users } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  provisionInternalMemberAction,
  type ProvisionInternalMemberState,
} from "../../app/actions/member-account-provisioning";
import styles from "./create-member-account-form.module.css";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className={styles.submit} disabled={pending} type="submit">
      {pending ? (
        <LoaderCircle className={styles.spinner} aria-hidden="true" />
      ) : (
        <UserRoundPlus aria-hidden="true" />
      )}

      {pending ? "Adding member..." : "Add member"}
    </button>
  );
}

function FieldError({ children }: { children?: string }) {
  if (!children) {
    return null;
  }

  return (
    <p className={styles.fieldError} role="alert">
      {children}
    </p>
  );
}

/**
 * Wolf Forge members only. Client portal accounts are a separate account class
 * with a separate boundary and stay on /accounts/client/new.
 *
 * Owner is intentionally absent: it is not an ordinary provisioning choice.
 */
export function CreateMemberAccountForm() {
  const initialState: ProvisionInternalMemberState = {
    error: null,
    fieldErrors: {},
  };

  const [state, action] = useActionState(provisionInternalMemberAction, initialState);
  const [preset, setPreset] = useState("staff");
  const presets = [
    { key: "admin", label: "Administrator", description: "Full operational administration, excluding Owner-only controls.", Icon: Shield },
    { key: "manager", label: "Manager", description: "Manage day-to-day work, people, and team tasks.", Icon: UserCog },
    { key: "staff", label: "Staff", description: "Standard access for everyday Wolf Forge work.", Icon: Users },
  ] as const;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1>Add team member</h1>

        <p>
          Create a real Wolf Forge login and assign the permission preset that decides
          what the member can reach.
        </p>
      </header>

      <div className={styles.securityNote}>
        <ShieldCheck aria-hidden="true" />

        <div>
          <strong>Secure provisioning</strong>

          <span>
            The login is created through the server-only Supabase admin boundary, and the
            preset is applied by the database against your own signed-in account.
            Passwords are never stored in Wolf Forge business tables.
          </span>
        </div>
      </div>

      <form action={action} className={styles.form}>
        {state.error ? (
          <div className={styles.banner} role="alert">
            {state.error}
          </div>
        ) : null}

        <div className={styles.field}>
          <label htmlFor="member-email">Email</label>

          <input
            id="member-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={320}
            required
            aria-invalid={Boolean(state.fieldErrors.email)}
          />

          <FieldError>{state.fieldErrors.email}</FieldError>
        </div>

        <div className={styles.grid}>
          <div className={styles.field}>
            <label htmlFor="member-first-name">
              First name
              <span>optional</span>
            </label>

            <input
              id="member-first-name"
              name="first_name"
              autoComplete="given-name"
              maxLength={100}
              aria-invalid={Boolean(state.fieldErrors.firstName)}
            />

            <FieldError>{state.fieldErrors.firstName}</FieldError>
          </div>

          <div className={styles.field}>
            <label htmlFor="member-last-name">
              Last name
              <span>optional</span>
            </label>

            <input
              id="member-last-name"
              name="last_name"
              autoComplete="family-name"
              maxLength={100}
              aria-invalid={Boolean(state.fieldErrors.lastName)}
            />

            <FieldError>{state.fieldErrors.lastName}</FieldError>
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Permission preset</span>
          <input type="hidden" name="preset_key" value={preset} />
          <div
            className={styles.roleSelector}
            role="radiogroup"
            aria-label="Permission preset"
            aria-invalid={Boolean(state.fieldErrors.preset)}
          >
            {presets.map(({ key, label, description, Icon }, index) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={preset === key}
                className={[styles.roleOption, preset === key ? styles.roleOptionSelected : ""].filter(Boolean).join(" ")}
                onClick={() => setPreset(key)}
                onKeyDown={(event) => {
                  if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
                  event.preventDefault();
                  const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
                  const next = presets[(index + direction + presets.length) % presets.length]!;
                  setPreset(next.key);
                  document.getElementById(`member-preset-${next.key}`)?.focus();
                }}
                id={`member-preset-${key}`}
              >
                <span className={styles.roleIcon}><Icon aria-hidden="true" /></span>
                <span className={styles.roleCopy}><strong>{label}</strong><small>{description}</small></span>
                <span className={styles.roleRadio} aria-hidden="true" />
              </button>
            ))}
          </div>

          <p className={styles.fieldHint}>
            The preset can be changed later from Team &amp; Roles. Owner is not an
            assignable preset here.
          </p>

          <FieldError>{state.fieldErrors.preset}</FieldError>
        </div>

        <div className={styles.passwordSection}>
          <div className={styles.passwordHeading}>
            <KeyRound aria-hidden="true" />

            <div>
              <strong>Temporary login</strong>

              <span>
                Give this password to the member securely. Invitation email delivery is a
                later implementation phase.
              </span>
            </div>
          </div>

          <div className={styles.grid}>
            <div className={styles.field}>
              <label htmlFor="member-temporary-password">Temporary password</label>

              <input
                id="member-temporary-password"
                name="temporary_password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                required
                aria-invalid={Boolean(state.fieldErrors.password)}
              />

              <FieldError>{state.fieldErrors.password}</FieldError>
            </div>

            <div className={styles.field}>
              <label htmlFor="member-confirm-password">Confirm password</label>

              <input
                id="member-confirm-password"
                name="confirm_password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                required
                aria-invalid={Boolean(state.fieldErrors.confirmPassword)}
              />

              <FieldError>{state.fieldErrors.confirmPassword}</FieldError>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <Link href="/team" className={styles.cancel}>
            Cancel
          </Link>

          <SubmitButton />
        </div>
      </form>
    </div>
  );
}
