import {
  updateMyProfileSchema,
  type MyProfile,
} from "../domain/profile/schema";
import { parseInput } from "../domain/shared";
import {
  buildAvatarObjectPath,
  validateAvatarBytes,
  type AvatarValidationResult,
} from "../lib/images/avatar-file";
import type { ProfileRepository } from "../repositories/profile-repository";
import {
  requireVerifiedActor,
  type ServiceDependencies,
  type UserMutationActor,
} from "./mutation-context";

export type AvatarSaveResult =
  | { ok: true; avatarUrl: string }
  | { ok: false; error: string };

/**
 * Self-service profile operations.
 *
 * The database decides authorization; this service validates shapes, derives
 * the storage object path from the *verified* actor rather than from anything
 * the browser sent, and sequences avatar replacement so a failed cleanup can
 * never undo a committed profile change.
 */
export class ProfileService {
  constructor(private readonly dependencies: ServiceDependencies<ProfileRepository>) {}

  getMine(): Promise<MyProfile | null> {
    return this.dependencies.repository.getMine();
  }

  async updateMine(input: unknown, actor: UserMutationActor): Promise<void> {
    requireVerifiedActor(actor);
    await this.dependencies.repository.updateMine(parseInput(updateMyProfileSchema, input));
  }

  /**
   * Validates the bytes, stores the object and persists the profile pointer.
   *
   * Sequence is deliberate: upload the new object, persist it, and only then
   * remove the object it replaced. At no point is the old avatar deleted before
   * the replacement is durable, so an interrupted save leaves the account with
   * its previous photo rather than none.
   *
   * Security C2-3 adds one step in front of all of it. `claimAvatarUpload()`
   * carries the same authorization gate as the persist RPC plus a per-actor
   * frequency bound, and it runs BEFORE `uploadAvatarObject`, because the
   * storage write is the cost being defended: Storage accepts the object under
   * its own owner-scoped policy without consulting any RPC, so a throttle
   * placed after it would bound the bookkeeping and not the bytes.
   *
   * A throttled or unauthorized caller therefore leaves nothing behind at all
   * — no object, no orphan, no cleanup to depend on.
   */
  async saveMineAvatar(
    input: { bytes: Uint8Array; declaredSize?: number },
    actor: UserMutationActor,
  ): Promise<AvatarSaveResult> {
    requireVerifiedActor(actor);

    const validation: AvatarValidationResult = validateAvatarBytes(
      input.bytes,
      input.declaredSize,
    );

    if (!validation.ok) return { ok: false, error: validation.error };

    /* Refused here means no bytes are ever written. Throws, so the throttle
     * reaches the caller as a RATE_LIMITED failure rather than a silent skip. */
    await this.dependencies.repository.claimAvatarUpload();

    /*
     * The folder segment is the verified actor id, so the caller cannot aim the
     * upload at another account even by tampering with the request. The
     * filename is random, so an upload can never clobber an existing object.
     */
    const objectPath = buildAvatarObjectPath(
      actor.id,
      validation.format,
      crypto.randomUUID(),
    );

    await this.dependencies.repository.uploadAvatarObject(
      objectPath,
      input.bytes,
      validation.format.mimeType,
    );

    const publicUrl = this.dependencies.repository.publicAvatarUrl(objectPath);

    let replacedPath: string | null = null;
    try {
      replacedPath = await this.dependencies.repository.setMineAvatar(objectPath, publicUrl);
    } catch (error) {
      /*
       * Persisting failed, so the object just uploaded is an orphan. Remove it
       * before surfacing the failure, then let the caller report the error.
       */
      await this.dependencies.repository
        .removeAvatarObject(objectPath)
        .catch(() => undefined);
      throw error;
    }

    if (replacedPath) {
      await this.dependencies.repository
        .removeAvatarObject(replacedPath)
        .catch(() => undefined);
    }

    return { ok: true, avatarUrl: publicUrl };
  }

  /** Clears the pointer first, then removes the object it referenced. */
  async removeMineAvatar(actor: UserMutationActor): Promise<void> {
    requireVerifiedActor(actor);

    const removedPath = await this.dependencies.repository.clearMineAvatar();

    if (removedPath) {
      await this.dependencies.repository
        .removeAvatarObject(removedPath)
        .catch(() => undefined);
    }
  }
}
