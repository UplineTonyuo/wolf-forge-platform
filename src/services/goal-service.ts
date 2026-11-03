import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { GOAL_PHOTO_MAX_BYTES, goalInputSchema, goalVisibilitySchema, type GoalVisibility } from "../domain/goals/schema";
import { ValidationError } from "../lib/errors/application-error";
import { validateAvatarBytes } from "../lib/images/avatar-file";
import type { GoalRepository } from "../repositories/goal-repository";
import type { TicketAttachmentStorageRepository } from "../repositories/ticket-attachment-storage-repository";
import { requireVerifiedActor, type UserMutationActor } from "./mutation-context";

export class GoalService {
  constructor(private readonly repository: GoalRepository, private readonly storage?: TicketAttachmentStorageRepository) {}
  list(before: string | null = null, visibility: GoalVisibility | null = null) {
    return this.repository.list(before === null ? null : z.uuid().parse(before), goalVisibilitySchema.nullable().parse(visibility));
  }
  get(id: string) { return this.repository.get(z.uuid().parse(id)); }
  members() { return this.repository.members(); }
  save(id: string | null, input: unknown, revision: string | null, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.repository.save(id === null ? null : z.uuid().parse(id), goalInputSchema.parse(input), revision === null ? null : z.iso.datetime({ offset: true }).parse(revision));
  }
  complete(id: string, milestoneId: string, completed: boolean, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.repository.complete(z.uuid().parse(id), z.uuid().parse(milestoneId), z.boolean().parse(completed));
  }
  async uploadPhoto(id: string, source: Uint8Array | (() => Promise<Uint8Array>), actor: UserMutationActor) {
    requireVerifiedActor(actor); z.uuid().parse(id);
    if (!this.storage) throw new Error("Goal photo storage is unavailable.");
    // Admission and current authorization precede buffering and paid Storage work.
    const context = await this.repository.photoContext(id, true);
    const bytes = typeof source === "function" ? await source() : source;
    const checked = validateAvatarBytes(bytes);
    if (bytes.length > GOAL_PHOTO_MAX_BYTES || !checked.ok) throw new ValidationError("Choose a JPEG, PNG or WebP photo, 2 MB or smaller.");
    const path = [context.tenant_id, id, randomUUID() + "." + checked.format.extension].join("/");
    const checksum = this.storage.checksum(bytes);
    await this.storage.storeOrConfirm(path, bytes, checked.format.mimeType, checksum);
    let saved;
    try {
      saved = await this.repository.setPhoto(id, { path, mime: checked.format.mimeType, size: bytes.length, checksum, revision: context.updated_at });
    } catch (error) {
      const current = await this.repository.get(id).catch(() => null);
      if (current?.photo_path !== path) {
        // shortcut: retain an uncertain upload; bounded admission limits orphan growth until reconciliation.
        throw error;
      }
      saved = current;
    }
    if (saved.id !== id || saved.photo_path !== path) throw new ValidationError("Photo save could not be confirmed. Reload this goal.");
    if (context.photo_path && context.photo_path !== path) await this.storage.remove(context.photo_path).catch(() => undefined);
    return saved;
  }
}
