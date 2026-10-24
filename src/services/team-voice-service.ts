import "server-only";

import { parseInput } from "../domain/shared";
import {
  finalizeTeamVoiceUploadSchema,
  prepareTeamVoiceUploadSchema,
  teamConversationMessageSchema,
  teamVoicePlaybackUrlSeconds,
  type TeamMessageWriteRow,
} from "../domain/team/schema";
import {
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "../lib/errors/application-error";
import { readTeamVoiceRetentionDays } from "../lib/env/team-voice-env";
import { inspectTeamVoiceBytes } from "../lib/team-voice/media-inspection";
import { enforceServerCostLimit } from "../lib/security/server-cost-limit";
import type { TeamRepository } from "../repositories/team-repository";
import type { TeamVoiceStorageRepository } from "../repositories/team-voice-storage-repository";
import { requireVerifiedActor, type UserMutationActor } from "./mutation-context";

export class TeamVoiceService {
  constructor(
    private readonly team: TeamRepository,
    private readonly storage: TeamVoiceStorageRepository,
  ) {}

  async prepareUpload(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    const parsed = parseInput(prepareTeamVoiceUploadSchema, input);
    const detail = await this.team.getConversation({ conversationId: parsed.conversationId });
    if (detail.my_capabilities?.can_send_voice !== true) throw new PermissionDeniedError();

    // The mutation RPC repeats owner/admin + membership checks before creating the claim.
    const claim = await this.team.prepareVoiceUpload(parsed);
    const uploadUrl = await this.storage.createSignedUploadUrl(claim.storage_path);
    return {
      uploadId: claim.upload_id,
      uploadUrl,
      mimeType: claim.declared_mime_type,
      expiresAt: claim.expires_at,
    };
  }

  async finalizeUpload(input: unknown, actor: UserMutationActor): Promise<TeamMessageWriteRow> {
    requireVerifiedActor(actor);
    const parsed = parseInput(finalizeTeamVoiceUploadSchema, input);
    const upload = await this.team.getVoiceUploadContext(parsed.uploadId);
    const detail = await this.team.getConversation({ conversationId: upload.conversation_id });
    if (detail.my_capabilities?.can_send_voice !== true) throw new PermissionDeniedError();
    if (upload.status === "abandoned") throw new ValidationError("Voice upload has expired.");

    await enforceServerCostLimit({ actorId: actor.id, action: "team.voice.finalize" });
    const object = await this.storage.inspectObject(upload.storage_path);
    const inspected = await inspectTeamVoiceBytes({
      bytes: object.bytes,
      objectSize: object.size,
      objectMimeType: object.contentType,
      declaredMimeType: upload.declared_mime_type,
      recordedDurationMs: parsed.recordedDurationMs,
    });

    // Canonical values below come from the server-side object and media probe.
    return this.team.finalizeVoiceUpload({
      uploadId: upload.upload_id,
      durationMs: inspected.durationMs,
      sizeBytes: inspected.sizeBytes,
      mimeType: inspected.mimeType,
      retentionDays: readTeamVoiceRetentionDays(),
    });
  }

  async playback(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    const parsed = parseInput(teamConversationMessageSchema, input);

    // Service boundary: prove requested conversation access first.
    await this.team.getConversation({ conversationId: parsed.conversationId });
    // Database boundary: derive the message's real conversation and prove membership again.
    const voice = await this.team.getVoicePlayback(parsed.messageId);
    if (voice.conversation_id !== parsed.conversationId) throw new PermissionDeniedError();
    if (voice.expired_at || !voice.storage_path) throw new NotFoundError("Voice recording");

    const url = await this.storage.createSignedPlaybackUrl(
      voice.storage_path,
      teamVoicePlaybackUrlSeconds,
    );
    return {
      url,
      expiresAt: new Date(Date.now() + teamVoicePlaybackUrlSeconds * 1000).toISOString(),
    };
  }
}

export class TeamVoiceCleanupService {
  constructor(private readonly storage: TeamVoiceStorageRepository) {}

  async runBatch(limit = 100): Promise<{ selected: number; removed: number; failed: number }> {
    const boundedLimit = Math.min(250, Math.max(1, Math.trunc(limit)));
    const rows = await this.storage.listCleanupBatch(boundedLimit);
    let removed = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        // Supabase Storage remove is idempotent for an already-missing key.
        await this.storage.removeObject(row.storage_path);
        await this.storage.markCleanupComplete(row);
        removed += 1;
      } catch {
        // Leave the canonical pointer intact so the next daily batch can retry safely.
        failed += 1;
      }
    }

    return { selected: rows.length, removed, failed };
  }
}
