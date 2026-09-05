import "server-only";

import { z } from "zod";
import type { EnvironmentSource } from "./public-env";

/**
 * A Google Cloud service account with read-only access to the target
 * spreadsheet — not the Gmail OAuth user-consent flow (`google-oauth-env.ts`),
 * which is the wrong shape for unattended internal reads of one shared
 * workbook. `GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY` is the PEM private
 * key from the service account's JSON key file; the sheet itself must be
 * shared with the service account's email as a Viewer.
 */
const googleSheetsServiceAccountEnvironmentSchema = z.object({
  GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: z.string().trim().email(),
  GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().trim().min(1),
});

const googleSheetsEnvironmentSchema = googleSheetsServiceAccountEnvironmentSchema.extend({
  PODCAST_SEO_SPREADSHEET_ID: z.string().trim().min(1),
});

const contentGoogleSheetsEnvironmentSchema = googleSheetsServiceAccountEnvironmentSchema.extend({
  CONTENT_WORKFLOW_SPREADSHEET_ID: z.string().trim().min(1),
});

export type GoogleSheetsServiceAccountEnvironment = z.infer<
  typeof googleSheetsServiceAccountEnvironmentSchema
>;
/** Backward-compatible Podcast environment name used by the shipped source and its tests. */
export type GoogleSheetsEnvironment = z.infer<typeof googleSheetsEnvironmentSchema>;
export type ContentGoogleSheetsEnvironment = z.infer<typeof contentGoogleSheetsEnvironmentSchema>;

export function readGoogleSheetsServiceAccountEnvironment(
  source: EnvironmentSource = process.env,
): GoogleSheetsServiceAccountEnvironment {
  return googleSheetsServiceAccountEnvironmentSchema.parse(source);
}

export function readGoogleSheetsEnvironment(
  source: EnvironmentSource = process.env,
): GoogleSheetsEnvironment {
  return googleSheetsEnvironmentSchema.parse(source);
}

export function isGoogleSheetsSourceConfigured(source: EnvironmentSource = process.env): boolean {
  return googleSheetsEnvironmentSchema.safeParse(source).success;
}

export function readContentGoogleSheetsEnvironment(
  source: EnvironmentSource = process.env,
): ContentGoogleSheetsEnvironment {
  return contentGoogleSheetsEnvironmentSchema.parse(source);
}

export function isContentWorkflowSourceConfigured(
  source: EnvironmentSource = process.env,
): boolean {
  return contentGoogleSheetsEnvironmentSchema.safeParse(source).success;
}
