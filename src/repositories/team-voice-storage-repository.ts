import "server-only";

import type { TeamVoiceCleanupObjectRow } from "../domain/team/schema";
import { DatabaseError } from "../lib/errors/application-error";
import type { TrustedServerClient } from "../lib/supabase/trusted-server-client";

export const TEAM_VOICE_BUCKET = "team-voice-messages";

type UntypedRpcResult = { data: unknown; error: unknown };

export class TeamVoiceStorageRepository {
  constructor(private readonly client: TrustedServerClient) {}

  async createSignedUploadUrl(path: string): Promise<string> {
    const result = await this.client.storage
      .from(TEAM_VOICE_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (result.error || !result.data) throw new DatabaseError(result.error);
    return result.data.signedUrl;
  }

  async inspectObject(path: string): Promise<{
    bytes: Uint8Array;
    size: number;
    contentType: string | null;
  }> {
    const bucket = this.client.storage.from(TEAM_VOICE_BUCKET);
    const info = await bucket.info(path);
    if (info.error || !info.data) throw new DatabaseError(info.error);

    const download = await bucket.download(path);
    if (download.error || !download.data) throw new DatabaseError(download.error);
    const bytes = new Uint8Array(await download.data.arrayBuffer());

    return {
      bytes,
      size: info.data.size ?? bytes.byteLength,
      contentType: info.data.contentType ?? null,
    };
  }

  async createSignedPlaybackUrl(path: string, expiresIn: number): Promise<string> {
    const result = await this.client.storage
      .from(TEAM_VOICE_BUCKET)
      .createSignedUrl(path, expiresIn);
    if (result.error || !result.data) throw new DatabaseError(result.error);
    return result.data.signedUrl;
  }

  async listCleanupBatch(limit: number): Promise<TeamVoiceCleanupObjectRow[]> {
    const rpc = this.client.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<UntypedRpcResult>;
    const result = await rpc("app_list_team_voice_cleanup_batch", { p_limit: limit });
    if (result.error) throw new DatabaseError(result.error);
    return (result.data ?? []) as TeamVoiceCleanupObjectRow[];
  }

  async removeObject(path: string): Promise<void> {
    const result = await this.client.storage.from(TEAM_VOICE_BUCKET).remove([path]);
    if (result.error) throw new DatabaseError(result.error);
  }

  async markCleanupComplete(row: TeamVoiceCleanupObjectRow): Promise<void> {
    const rpc = this.client.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<UntypedRpcResult>;
    const result = await rpc("app_complete_team_voice_cleanup", {
      p_object_kind: row.object_kind,
      p_record_id: row.record_id,
      p_expected_path: row.storage_path,
    });
    if (result.error) throw new DatabaseError(result.error);
  }
}
