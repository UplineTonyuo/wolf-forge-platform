import "server-only";

import {
  teamVoiceDefaultRetentionDays,
  teamVoiceMaxRetentionDays,
  teamVoiceMinRetentionDays,
} from "../../domain/team/schema";
import type { EnvironmentSource } from "./public-env";

export function readTeamVoiceRetentionDays(
  source: EnvironmentSource = process.env,
): number {
  const parsed = Number(source.TEAM_VOICE_RETENTION_DAYS);
  if (!Number.isInteger(parsed)) return teamVoiceDefaultRetentionDays;
  return Math.min(teamVoiceMaxRetentionDays, Math.max(teamVoiceMinRetentionDays, parsed));
}

/** Missing configuration disables the scheduled cleanup route without affecting the app. */
export function readTeamVoiceCleanupSecret(
  source: EnvironmentSource = process.env,
): string | null {
  const value = source.CRON_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}
