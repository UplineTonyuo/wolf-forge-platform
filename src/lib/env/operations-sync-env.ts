import "server-only";

import { z } from "zod";
import type { EnvironmentSource } from "./public-env";

/**
 * The shared secret used to verify the HMAC-SHA256 signature on the Podcast
 * SEO Apps Script change-notification webhook (`POST
 * /api/operations/podcast-seo/sync`). This is the ONLY credential that
 * webhook trusts — there is no session, no cookie, no Supabase actor for an
 * Apps Script caller. 32 chars is a floor, not a recommendation: generate a
 * long random value (e.g. `openssl rand -hex 32`) and store the same value in
 * the Apps Script Property `WOLF_FORGE_OPERATIONS_WEBHOOK_SECRET`.
 */
const operationsSyncEnvironmentSchema = z.object({
  OPERATIONS_SYNC_WEBHOOK_SECRET: z.string().trim().min(32),
});

export type OperationsSyncEnvironment = z.infer<typeof operationsSyncEnvironmentSchema>;

export function readOperationsSyncEnvironment(
  source: EnvironmentSource = process.env,
): OperationsSyncEnvironment {
  return operationsSyncEnvironmentSchema.parse(source);
}

export function isOperationsSyncConfigured(source: EnvironmentSource = process.env): boolean {
  return operationsSyncEnvironmentSchema.safeParse(source).success;
}
