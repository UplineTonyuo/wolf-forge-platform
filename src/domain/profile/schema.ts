import { z } from "zod";

/**
 * Self-service profile domain.
 *
 * Only fields an account may change about itself live here. Role, preset,
 * account class, company and email are read-only projections: they have
 * authoritative sources elsewhere (Team & Roles and Supabase Auth) and are
 * never accepted as input.
 */

export const DISPLAY_NAME_MAX = 120;

export const updateMyProfileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "Enter a display name.")
    .max(DISPLAY_NAME_MAX, "Display name is too long."),
  notification_sound_enabled: z.boolean(),
});

export type UpdateMyProfileInput = z.infer<typeof updateMyProfileSchema>;

/**
 * Result shape of the profile update action.
 *
 * This and its initial value live here rather than beside the action because a
 * "use server" module may only export async functions — Next.js rejects the
 * whole module otherwise, taking down every route that imports it.
 */
export type ProfileActionState = {
  error: string | null;
  fieldErrors: Record<string, string>;
  /** ISO timestamp of the last successful save, used to confirm in the UI. */
  savedAt: string | null;
};

export const initialProfileActionState: ProfileActionState = {
  error: null,
  fieldErrors: {},
  savedAt: null,
};

/** Read-only identity projection for the Settings surface. */
export type MyProfile = {
  profileId: string;
  displayName: string | null;
  email: string | null;
  /** Underlying role name, e.g. "owner". Never editable from Settings. */
  roleName: string;
  /** Presentation preset, e.g. "Administrator". */
  presetKey: string | null;
  presetName: string | null;
  avatarPath: string | null;
  avatarUrl: string | null;
  notificationSoundEnabled: boolean;
  createdAt: string;
};

export type MyProfileRow = {
  profile_id: string;
  display_name: string | null;
  email: string | null;
  role_name: string;
  preset_key: string | null;
  preset_name: string | null;
  avatar_path: string | null;
  avatar_url: string | null;
  notification_sound_enabled: boolean;
  created_at: string;
};

export function toMyProfile(row: MyProfileRow): MyProfile {
  return {
    profileId: row.profile_id,
    displayName: row.display_name,
    email: row.email,
    roleName: row.role_name,
    presetKey: row.preset_key,
    presetName: row.preset_name,
    avatarPath: row.avatar_path,
    avatarUrl: row.avatar_url,
    notificationSoundEnabled: row.notification_sound_enabled,
    createdAt: row.created_at,
  };
}

/** Initials fallback shown whenever an account has no avatar object. */
export function profileInitials(name: string | null | undefined): string {
  const clean = name?.trim();
  if (!clean) return "•";

  return clean
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}
