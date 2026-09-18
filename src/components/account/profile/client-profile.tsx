"use client";

import { Check, Loader2, Trash2, Upload } from "lucide-react";
import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import {
  removeMyAvatarAction,
  updateMyProfileAction,
  uploadMyAvatarAction,
} from "../../../app/actions/profile";
import {
  DISPLAY_NAME_MAX,
  initialProfileActionState,
  type MyProfile,
} from "../../../domain/profile/schema";
import type { SignInIdentity } from "../../../domain/profile/security";
import { AVATAR_MAX_BYTES } from "../../../lib/images/avatar-file";
import { SecuritySection } from "../../settings/security-section";
import { AccountAvatar } from "../../ui/account-avatar";
import { SuccessToast } from "../../ui/success-toast";

/** Mirrors the server-side allowlist so the picker rejects early, for UX only. */
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * The client account's own profile.
 *
 * Deliberately NOT the internal SettingsWorkspace. That surface renders the
 * account's role, its permission preset and a pointer to Team & Roles — all
 * internal mechanics a client should never be shown, let alone offered. This
 * component exposes only the three things a client account may change about
 * itself, and each goes through the same self-service RPC the internal surface
 * uses: one that takes no profile id and resolves the account from auth.uid().
 *
 * Company name and email are read-only. Both have authoritative sources
 * elsewhere (the Wolf Forge team, and Supabase Auth) and are not accepted as
 * input by app_update_my_profile at all.
 */
export function ClientProfile({
  profile,
  companyName,
  identities,
}: {
  profile: MyProfile;
  companyName: string;
  identities: SignInIdentity[];
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

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [avatarBusy, startAvatarTransition] = useTransition();

  function notify(message: string) {
    setToast((current) => ({ id: (current?.id ?? 0) + 1, message }));
  }

  /* Object URLs are released on unmount so a long session cannot leak them. */
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  function clearPreview() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
  }

  function chooseFile(file: File | null) {
    if (!file) return;
    setAvatarError(null);

    /*
     * Cheap client-side rejection only. The server re-derives the real file
     * type from the bytes and re-checks the size, so nothing here is trusted.
     */
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setAvatarError("Choose a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError("Image must be smaller than 5 MB.");
      return;
    }

    clearPreview();
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setPreviewUrl(url);

    const formData = new FormData();
    formData.set("avatar", file);

    startAvatarTransition(async () => {
      const result = await uploadMyAvatarAction(formData);
      clearPreview();
      if (result.ok) notify("Photo updated.");
      else setAvatarError(result.error);
    });
  }

  function removePhoto() {
    setAvatarError(null);
    startAvatarTransition(async () => {
      const result = await removeMyAvatarAction();
      if (result.ok) notify("Photo removed.");
      else setAvatarError(result.error);
    });
  }

  const shownAvatar = previewUrl ?? profile.avatarUrl;

  return (
    <div className="portal-page">
      <header className="portal-page-head">
        <h1>Profile</h1>
        <p>Your name, photo and sign-in details for the Wolf Forge workspace.</p>
      </header>

      <section className="portal-section" aria-labelledby="portal-profile-identity">
        <header className="portal-section-head">
          <h2 id="portal-profile-identity">Your details</h2>
        </header>

        <div className="portal-card portal-profile-card">
          <div className="portal-profile-avatar">
            <AccountAvatar
              name={profile.displayName ?? companyName}
              avatarUrl={shownAvatar}
              size={72}
            />

            <div className="portal-profile-avatar-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES.join(",")}
                className="sr-only"
                onChange={(event) => {
                  chooseFile(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="portal-ghost-action"
                onClick={() => fileInputRef.current?.click()}
                aria-busy={avatarBusy || undefined}
                disabled={avatarBusy}
              >
                {avatarBusy ? (
                  <Loader2 className="spinner" aria-hidden="true" />
                ) : (
                  <Upload aria-hidden="true" />
                )}
                {profile.avatarUrl ? "Change photo" : "Add a photo"}
              </button>

              {profile.avatarUrl ? (
                <button
                  type="button"
                  className="portal-ghost-action"
                  onClick={removePhoto}
                  disabled={avatarBusy}
                >
                  <Trash2 aria-hidden="true" />
                  Remove
                </button>
              ) : null}

              {avatarError ? (
                <p className="portal-field-error" role="alert">
                  {avatarError}
                </p>
              ) : null}
            </div>
          </div>

          <form action={submit} className="portal-form">
            <label className="portal-field" htmlFor={displayNameId}>
              <span>Display name</span>
              <input
                id={displayNameId}
                name="display_name"
                defaultValue={profile.displayName ?? ""}
                maxLength={DISPLAY_NAME_MAX}
                required
                aria-invalid={state.fieldErrors.display_name ? true : undefined}
                aria-describedby={
                  state.fieldErrors.display_name ? displayNameErrorId : undefined
                }
              />
              {state.fieldErrors.display_name ? (
                <span className="portal-field-error" id={displayNameErrorId} role="alert">
                  {state.fieldErrors.display_name}
                </span>
              ) : null}
            </label>

            {/* Read-only projections. Neither is accepted by the update RPC. */}
            <div className="portal-field">
              <span>Email</span>
              <output>{profile.email ?? "Not set"}</output>
            </div>

            <div className="portal-field">
              <span>Company</span>
              <output>{companyName}</output>
            </div>

            <label className="portal-toggle" htmlFor={soundId}>
              <input
                id={soundId}
                type="checkbox"
                name="notification_sound_enabled"
                defaultChecked={profile.notificationSoundEnabled}
              />
              <span>
                <strong>Notification sound</strong>
                <span>Play a short chime when a new notification arrives.</span>
              </span>
            </label>

            {state.error ? (
              <p className="portal-field-error" role="alert">
                {state.error}
              </p>
            ) : null}

            <div className="portal-form-actions">
              <button type="submit" className="portal-primary-action" aria-busy={pending || undefined} disabled={pending}>
                {pending ? <Loader2 className="spinner" aria-hidden="true" /> : null}
                Save changes
              </button>
              {state.savedAt ? (
                <span className="portal-form-saved" role="status">
                  <Check aria-hidden="true" />
                  Saved
                </span>
              ) : null}
            </div>
          </form>
        </div>
      </section>

      {/*
       * Password and sign-in methods only. SecuritySection renders exactly what
       * Supabase Auth reports for this account and nothing speculative, so it is
       * safe to share with the internal Settings surface verbatim.
       */}
      <div className="portal-security">
        <SecuritySection
          identities={identities}
          onPasswordChanged={() => notify("Password updated.")}
        />
      </div>

      {toast ? <SuccessToast key={toast.id} title={toast.message} /> : null}
    </div>
  );
}
