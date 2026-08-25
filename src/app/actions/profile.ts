"use server";

import { revalidatePath } from "next/cache";
import type { ProfileActionState } from "../../domain/profile/schema";
import { toClientSafeError } from "../../lib/errors/application-error";
import { AVATAR_MAX_BYTES } from "../../lib/images/avatar-file";
import { getSelfServiceContext } from "../../lib/supabase/next-server";

/*
 * Only async functions may be exported from a "use server" module. The action
 * state type and its initial value live in domain/profile/schema.ts for that
 * reason; type-only exports are erased and are safe here.
 */
export type AvatarActionResult =
  | { ok: true; avatarUrl: string | null }
  | { ok: false; error: string };

/**
 * Every surface the new avatar appears on is server-rendered from the same
 * profile row, so one revalidation set keeps the shell, the account menu and
 * the team directory in step after a save.
 */
function refreshProfileSurfaces() {
  revalidatePath("/settings");
  revalidatePath("/settings/general");
  revalidatePath("/settings/notifications");
  revalidatePath("/team");
  // The client portal renders the same profile row in its rail and on its own
  // Profile page, so a save has to reach both workspaces.
  revalidatePath("/account/profile");
  revalidatePath("/", "layout");
}

/** Updates only the persisted personal notification-sound preference. */
export async function updateMyNotificationSoundAction(
  _state: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  void _state;
  const context = await getSelfServiceContext();

  try {
    const profile = await context.services.profile.getMine();
    if (!profile?.displayName) {
      return {
        error: "Your profile could not be loaded.",
        fieldErrors: {},
        savedAt: null,
      };
    }

    await context.services.profile.updateMine(
      {
        display_name: profile.displayName,
        notification_sound_enabled: formData.get("notification_sound_enabled") === "on",
      },
      context.actor,
    );
  } catch (error) {
    const safe = toClientSafeError(error);
    return {
      error: safe.code === "VALIDATION_ERROR" ? safe.message : "Unable to update notifications.",
      fieldErrors: {},
      savedAt: null,
    };
  }

  refreshProfileSurfaces();
  return { error: null, fieldErrors: {}, savedAt: new Date().toISOString() };
}

/**
 * Updates the signed-in account's own profile.
 *
 * There is no profile id in the signature: the RPC derives the account from
 * auth.uid(). Role, preset and email are not accepted here at all, so Settings
 * cannot be used to move an account between roles — that stays behind the Team
 * & Roles boundary.
 */
export async function updateMyProfileAction(
  _state: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  void _state;

  const displayName = String(formData.get("display_name") ?? "").trim();
  const notificationSound = formData.get("notification_sound_enabled") === "on";

  if (!displayName) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { display_name: "Enter a display name." },
      savedAt: null,
    };
  }

  const context = await getSelfServiceContext();

  try {
    await context.services.profile.updateMine(
      {
        display_name: displayName,
        notification_sound_enabled: notificationSound,
      },
      context.actor,
    );
  } catch (error) {
    const safe = toClientSafeError(error);
    return {
      error: safe.code === "VALIDATION_ERROR" ? safe.message : "Unable to update profile.",
      fieldErrors: {},
      savedAt: null,
    };
  }

  refreshProfileSurfaces();
  return { error: null, fieldErrors: {}, savedAt: new Date().toISOString() };
}

/**
 * Stores a new profile photo.
 *
 * The upload arrives as bytes and is identified by its real file signature in
 * the service layer — the browser's MIME type, the filename and the extension
 * are all discarded. The storage object path is generated from the verified
 * actor id, so it can only ever land in the caller's own folder.
 */
export async function uploadMyAvatarAction(formData: FormData): Promise<AvatarActionResult> {
  const file = formData.get("avatar");

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image to upload." };
  }

  /* Cheap rejection before buffering the whole upload into memory. */
  if (file.size > AVATAR_MAX_BYTES) {
    return { ok: false, error: "Image must be smaller than 5 MB." };
  }

  const context = await getSelfServiceContext();

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());

    const result = await context.services.profile.saveMineAvatar(
      { bytes, declaredSize: file.size },
      context.actor,
    );

    if (!result.ok) return result;

    refreshProfileSurfaces();
    return { ok: true, avatarUrl: result.avatarUrl };
  } catch {
    /* Storage and database detail never reaches the browser. */
    return { ok: false, error: "Unable to update your photo. Try again." };
  }
}

export async function removeMyAvatarAction(): Promise<AvatarActionResult> {
  const context = await getSelfServiceContext();

  try {
    await context.services.profile.removeMineAvatar(context.actor);
  } catch {
    return { ok: false, error: "Unable to remove your photo. Try again." };
  }

  refreshProfileSurfaces();
  return { ok: true, avatarUrl: null };
}
