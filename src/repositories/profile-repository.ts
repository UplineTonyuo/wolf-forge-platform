import {
  toMyProfile,
  type MyProfile,
  type MyProfileRow,
  type UpdateMyProfileInput,
} from "../domain/profile/schema";
import { unwrapMany } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

export const AVATAR_BUCKET = "profile-avatars";

/**
 * Self-service profile access.
 *
 * Every call is an audited SECURITY DEFINER RPC that derives the account from
 * auth.uid(); none of them take a profile id, so there is no parameter an
 * attacker could point at somebody else's row. public.profiles has no write
 * grant for `authenticated`, so there is no direct table path either.
 */
export class ProfileRepository {
  constructor(private readonly client: UserMutationClient) {}

  async getMine(): Promise<MyProfile | null> {
    const rows = unwrapMany(
      await this.client.rpc("app_get_my_profile"),
    ) as MyProfileRow[];

    const row = rows[0];
    return row ? toMyProfile(row) : null;
  }

  async updateMine(input: UpdateMyProfileInput): Promise<void> {
    const { error } = await this.client.rpc("app_update_my_profile", {
      p_display_name: input.display_name,
      p_notification_sound_enabled: input.notification_sound_enabled,
    });

    if (error) throw error;
  }

  /**
   * Uploads the avatar object under the caller's own folder. The storage
   * policies on storage.objects re-check that ownership, so a forged path is
   * rejected by the database rather than by this method.
   */
  async uploadAvatarObject(
    objectPath: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<void> {
    const { error } = await this.client.storage
      .from(AVATAR_BUCKET)
      .upload(objectPath, body, { contentType, upsert: false });

    if (error) throw error;
  }

  publicAvatarUrl(objectPath: string): string {
    return this.client.storage.from(AVATAR_BUCKET).getPublicUrl(objectPath).data
      .publicUrl;
  }

  /** Returns the replaced object path, if any, for post-commit cleanup. */
  async setMineAvatar(objectPath: string, publicUrl: string): Promise<string | null> {
    const rows = unwrapMany(
      await this.client.rpc("app_set_my_avatar", {
        p_avatar_path: objectPath,
        p_avatar_url: publicUrl,
      }),
    ) as Array<{ previous_avatar_path: string | null }>;

    return rows[0]?.previous_avatar_path ?? null;
  }

  /** Returns the removed object path, if any, for post-commit cleanup. */
  async clearMineAvatar(): Promise<string | null> {
    const rows = unwrapMany(
      await this.client.rpc("app_clear_my_avatar"),
    ) as Array<{ previous_avatar_path: string | null }>;

    return rows[0]?.previous_avatar_path ?? null;
  }

  /**
   * Best-effort removal of a superseded object. Never throws: a failed cleanup
   * must not undo a profile update that already committed. The delete is still
   * authorized by the owner-scoped storage policy, so this cannot touch another
   * account's object even if it were called with one.
   */
  async removeAvatarObject(objectPath: string): Promise<void> {
    await this.client.storage.from(AVATAR_BUCKET).remove([objectPath]);
  }
}
