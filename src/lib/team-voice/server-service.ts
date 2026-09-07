import "server-only";

import type { UserScopedClient } from "../supabase/user-client";
import { readServerEnvironment } from "../env/server-env";
import { createTrustedServerSupabaseClient } from "../supabase/trusted-server-client";
import { TeamRepository } from "../../repositories/team-repository";
import { TeamVoiceStorageRepository } from "../../repositories/team-voice-storage-repository";
import { TeamVoiceCleanupService, TeamVoiceService } from "../../services/team-voice-service";

export function createTeamVoiceService(client: UserScopedClient) {
  return new TeamVoiceService(
    new TeamRepository(client),
    new TeamVoiceStorageRepository(createTrustedServerSupabaseClient(readServerEnvironment())),
  );
}

export function createTeamVoiceCleanupService() {
  return new TeamVoiceCleanupService(
    new TeamVoiceStorageRepository(createTrustedServerSupabaseClient(readServerEnvironment())),
  );
}
