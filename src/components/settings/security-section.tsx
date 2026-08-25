"use client";

import { KeyRound, Mail, ShieldCheck } from "lucide-react";
import { useRef } from "react";
import {
  providerLabel,
  type SignInIdentity,
} from "../../domain/profile/security";
import { useAnimatedPopover } from "../ui/use-animated-popover";
import { PasswordDialog } from "./password-dialog";
import styles from "./settings-workspace.module.css";

/**
 * Account security.
 *
 * Two things live here and nothing else: the password, and the sign-in
 * identities Supabase Auth actually reports for this account. There is no
 * speculative provider list and no control that cannot currently do anything —
 * additional sign-in methods require an OAuth provider to be configured and
 * `enable_manual_linking` to be turned on, neither of which is true today.
 */
export function SecuritySection({
  identities,
  onPasswordChanged,
  showHeading = true,
}: {
  identities: SignInIdentity[];
  onPasswordChanged: () => void;
  showHeading?: boolean;
}) {
  /* Only providers other than the password credential can ever be unlinked. */
  const canLinkMore = identities.some((identity) => !identity.isPrimary);

  /*
   * The section owns the trigger and the open state; the dialog is purely
   * presentational plus its own action. `useAnimatedPopover` keeps the exit
   * transition playing before unmount.
   */
  const { render, phase, show, hide } = useAnimatedPopover(130);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function closeDialog() {
    hide();
    triggerRef.current?.focus();
  }

  return (
    <section className={styles.section} aria-label={showHeading ? undefined : "Account security"}>
      {showHeading ? <div className={styles.sectionHeading}>
        <h2>Security</h2>
        <p>How you sign in to Wolf Forge.</p>
      </div> : <div aria-hidden="true" />}

      <div className={styles.fields}>
        <div className={styles.toggleRow}>
          <div className={styles.toggleCopy}>
            <strong>Password</strong>
            <span>
              Keep your account protected with a strong password. Changing it
              signs out your other devices.
            </span>
          </div>

          <button
            ref={triggerRef}
            type="button"
            className={styles.secondary}
            onClick={show}
          >
            <KeyRound aria-hidden="true" />
            Change password
          </button>

          {render ? (
            <PasswordDialog
              isOpen={phase === "open"}
              onClose={closeDialog}
              onChanged={onPasswordChanged}
            />
          ) : null}
        </div>

        <div className={styles.field}>
          <span>Sign-in methods</span>

          <div className={styles.methodList}>
            {identities.map((identity) => (
              <div className={styles.methodRow} key={identity.id}>
                <span className={styles.methodIcon} aria-hidden="true">
                  {identity.provider === "email" ? <Mail /> : <ShieldCheck />}
                </span>

                <span className={styles.methodCopy}>
                  <strong>{providerLabel(identity.provider)}</strong>
                  <span>{identity.email ?? "No email reported"}</span>
                </span>

                {identity.isPrimary ? (
                  <span className={styles.methodBadge}>Primary</span>
                ) : (
                  <span className={styles.methodBadge}>Connected</span>
                )}
              </div>
            ))}
          </div>

          {/*
            Stated plainly rather than shown as a disabled button, because a
            control that cannot work is worse than an honest sentence.
          */}
          {canLinkMore ? null : (
            <p className={styles.securityNote}>
              Additional sign-in methods are not available on this workspace
              yet. Connecting Google or Microsoft has to be enabled for Wolf
              Forge before it can be offered here.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
