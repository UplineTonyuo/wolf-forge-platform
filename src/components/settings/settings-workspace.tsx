"use client";

import { Check, Lock, Loader2, Trash2, Upload, X } from "lucide-react";
import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import {
  removeMyAvatarAction,
  updateMyProfileAction,
  uploadMyAvatarAction,
} from "../../app/actions/profile";
import {
  DISPLAY_NAME_MAX,
  initialProfileActionState,
  type MyProfile,
} from "../../domain/profile/schema";
import type { SignInIdentity } from "../../domain/profile/security";
import { AVATAR_MAX_BYTES } from "../../lib/images/avatar-file";
import { AccountAvatar } from "../ui/account-avatar";
import { SuccessToast } from "../ui/success-toast";
import { SecuritySection } from "./security-section";
import styles from "./settings-workspace.module.css";

/** Mirrors the server-side allowlist so the picker rejects early for UX only. */
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function formatJoined(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

/**
 * The signed-in account's own Settings surface.
 *
 * Everything writable here belongs to the account itself. Role, preset and
 * email are rendered as read-only projections of boundaries owned elsewhere —
 * Team & Roles and Supabase Auth — and are never submitted.
 */
export function SettingsWorkspace({
  profile,
  identities,
  showPreferences = true,
  showSecurity = true,
}: {
  profile: MyProfile;
  /** Real sign-in identities from Supabase Auth, resolved on the server. */
  identities: SignInIdentity[];
  showPreferences?: boolean;
  showSecurity?: boolean;
}) {
  const [state, submit, pending] = useActionState(
    updateMyProfileAction,
    initialProfileActionState,
  );

  const displayNameId = useId();
  const displayNameErrorId = useId();
  const soundId = useId();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  /*
   * Avatar notices come from event handlers. The id increments per notice so
   * repeating the same message remounts the toast rather than being swallowed
   * by an unchanged key.
   */
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [avatarBusy, startAvatarTransition] = useTransition();

  function notify(message: string) {
    setToast((current) => ({ id: (current?.id ?? 0) + 1, message }));
  }

  /* Object URLs are released on unmount so a long session cannot leak them. */
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  function clearPreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileChosen(file: File | undefined) {
    setAvatarError(null);
    if (!file) return;

    /*
     * Client-side checks are a courtesy only. The server re-derives the format
     * from the file signature and enforces the size ceiling again.
     */
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setAvatarError("Image must be JPEG, PNG, or WebP.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError("Image must be smaller than 5 MB.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextPreview = URL.createObjectURL(file);
    previewUrlRef.current = nextPreview;
    setPreviewUrl(nextPreview);
    setPendingFile(file);
  }

  function savePhoto() {
    if (!pendingFile || avatarBusy) return;

    const formData = new FormData();
    formData.append("avatar", pendingFile);

    startAvatarTransition(async () => {
      const result = await uploadMyAvatarAction(formData);

      if (!result.ok) {
        setAvatarError(result.error);
        return;
      }

      clearPreview();
      setAvatarError(null);
      notify("Photo updated");
    });
  }

  function removePhoto() {
    if (avatarBusy) return;

    startAvatarTransition(async () => {
      const result = await removeMyAvatarAction();

      if (!result.ok) {
        setAvatarError(result.error);
        return;
      }

      clearPreview();
      setAvatarError(null);
      notify("Photo removed");
    });
  }

  const shownAvatar = previewUrl ?? profile.avatarUrl;
  const displayName = profile.displayName ?? "";
  const roleLabel = profile.presetName ?? profile.roleName;

  return (
    <>
      {state.savedAt ? (
        <SuccessToast key={state.savedAt} title="Profile updated" />
      ) : null}
      {toast ? <SuccessToast key={toast.id} title={toast.message} /> : null}

      <div className={styles.page}>
        <div className={styles.identity}>
          <div className={styles.avatarBlock}>
            <div className={styles.avatarFrame}>
              <AccountAvatar
                name={displayName}
                avatarUrl={shownAvatar}
                size={92}
                alt=""
              />

              <button
                type="button"
                className={styles.avatarButton}
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarBusy}
              >
                {avatarBusy ? "Working" : "Change"}
              </button>
            </div>

            <input
              ref={fileInputRef}
              id="settings-avatar-input"
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              aria-label="Choose a profile photo"
              hidden
              onChange={(event) => handleFileChosen(event.target.files?.[0])}
            />

            <div className={styles.avatarActions}>
              {pendingFile ? (
                <>
                  <button
                    type="button"
                    className={styles.quiet}
                    onClick={savePhoto}
                    aria-busy={avatarBusy || undefined}
                    disabled={avatarBusy}
                  >
                    {avatarBusy ? (
                      <Loader2 aria-hidden="true" />
                    ) : (
                      <Check aria-hidden="true" />
                    )}
                    {avatarBusy ? "Saving" : "Save photo"}
                  </button>

                  <button
                    type="button"
                    className={styles.quiet}
                    onClick={clearPreview}
                    disabled={avatarBusy}
                  >
                    <X aria-hidden="true" />
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.quiet}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={avatarBusy}
                  >
                    <Upload aria-hidden="true" />
                    Change photo
                  </button>

                  {profile.avatarUrl ? (
                    <button
                      type="button"
                      className={`${styles.quiet} ${styles.danger}`}
                      onClick={removePhoto}
                      disabled={avatarBusy}
                    >
                      <Trash2 aria-hidden="true" />
                      Remove
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>

          <div className={styles.identityCopy}>
            <p className={styles.identityName}>
              {displayName || "Unnamed account"}
            </p>

            <div className={styles.identityMeta}>
              <span className={styles.rolePill}>{roleLabel}</span>
              <span className={styles.identityEmail}>
                {profile.email ?? "No email on file"}
              </span>
            </div>

            {avatarError ? (
              <span className={styles.fieldError} role="alert">
                {avatarError}
              </span>
            ) : null}
          </div>
        </div>

        {/* Password controls live in Security, never in this form. */}
        <form action={submit}>
        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2>Profile</h2>
            <p>How your account appears to the rest of the workspace.</p>
          </div>

          <div className={styles.fields}>
            <div className={styles.field}>
              <label htmlFor={displayNameId}>Display name</label>
              <input
                id={displayNameId}
                name="display_name"
                type="text"
                defaultValue={displayName}
                maxLength={DISPLAY_NAME_MAX}
                required
                autoComplete="name"
                aria-invalid={state.fieldErrors.display_name ? "true" : undefined}
                aria-describedby={
                  state.fieldErrors.display_name ? displayNameErrorId : undefined
                }
              />
              {state.fieldErrors.display_name ? (
                <span className={styles.fieldError} id={displayNameErrorId}>
                  {state.fieldErrors.display_name}
                </span>
              ) : null}
            </div>

            <div className={styles.field}>
              <span>Role</span>
              <div className={styles.readOnlyValue}>
                <Lock aria-hidden="true" />
                {roleLabel}
              </div>
              <span className={styles.fieldHint}>
                Roles are managed in Team &amp; Roles by an account with
                permission administration.
              </span>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2>Account</h2>
            <p>Identity held by Wolf Forge authentication.</p>
          </div>

          <div className={styles.fields}>
            <div className={styles.field}>
              <span>Email</span>
              <div className={styles.readOnlyValue}>
                <Lock aria-hidden="true" />
                {profile.email ?? "No email on file"}
              </div>
              <span className={styles.fieldHint}>
                Email and password changes are handled by an administrator so
                the sign-in identity stays verified.
              </span>
            </div>

            <div className={styles.field}>
              <span>Member since</span>
              <div className={styles.readOnlyValue}>
                {formatJoined(profile.createdAt)}
              </div>
            </div>
          </div>
        </section>

        {showPreferences ? <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2>Preferences</h2>
            <p>Personal to this account. Nobody else is affected.</p>
          </div>

          <div className={styles.fields}>
            <div className={styles.toggleRow}>
              <div className={styles.toggleCopy}>
                <strong>Notification sound</strong>
                <span>
                  Play a short chime when a new notification arrives in the
                  command bar.
                </span>
              </div>

              <label className={styles.switch} htmlFor={soundId}>
                <input
                  id={soundId}
                  name="notification_sound_enabled"
                  type="checkbox"
                  defaultChecked={profile.notificationSoundEnabled}
                />
                <span className={styles.switchTrack} aria-hidden="true" />
                <span className={styles.switchThumb} aria-hidden="true" />
              </label>
            </div>
          </div>
        </section> : (
          <input
            type="hidden"
            name="notification_sound_enabled"
            value={profile.notificationSoundEnabled ? "on" : ""}
          />
        )}

        {/* Empty first cell keeps the action on the same axis as the fields. */}
        <div className={styles.footer}>
          <div />

          <div className={styles.footerActions}>
            {state.error ? (
              <span className={styles.footerError} role="alert">
                {state.error}
              </span>
            ) : (
              <span className={styles.footerStatus}>
                Changes apply to your account only.
              </span>
            )}

            <button type="submit" className={styles.primary} aria-busy={pending || undefined} disabled={pending}>
              {pending ? <Loader2 aria-hidden="true" /> : null}
              {pending ? "Saving" : "Save changes"}
            </button>
          </div>
        </div>
        </form>

        {showSecurity ? <SecuritySection
          identities={identities}
          onPasswordChanged={() => notify("Password updated")}
        /> : null}
      </div>
    </>
  );
}
