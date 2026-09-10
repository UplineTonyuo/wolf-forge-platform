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

const onPageSeoGoogleSheetsEnvironmentSchema = googleSheetsServiceAccountEnvironmentSchema.extend({
  ON_PAGE_SEO_SPREADSHEET_ID: z.string().trim().min(1),
});

const gmbManagementGoogleSheetsEnvironmentSchema = googleSheetsServiceAccountEnvironmentSchema.extend({
  GMB_MANAGEMENT_SPREADSHEET_ID: z.string().trim().min(1),
});

const youtubeSeoGoogleSheetsEnvironmentSchema = googleSheetsServiceAccountEnvironmentSchema.extend({
  YOUTUBE_SEO_SPREADSHEET_ID: z.string().trim().min(1),
});

const websiteBuilderGoogleSheetsEnvironmentSchema = googleSheetsServiceAccountEnvironmentSchema.extend({
  WEBSITE_BUILDER_SPREADSHEET_ID: z.string().trim().min(1),
});

const technicalSeoGoogleSheetsEnvironmentSchema = googleSheetsServiceAccountEnvironmentSchema.extend({
  TECHNICAL_SEO_SPREADSHEET_ID: z.string().trim().min(1),
});
export type TechnicalSeoGoogleSheetsEnvironment = z.infer<typeof technicalSeoGoogleSheetsEnvironmentSchema>;
export function readTechnicalSeoGoogleSheetsEnvironment(source: EnvironmentSource = process.env): TechnicalSeoGoogleSheetsEnvironment {
  return technicalSeoGoogleSheetsEnvironmentSchema.parse(source);
}

const offPageSeoGoogleSheetsEnvironmentSchema = googleSheetsServiceAccountEnvironmentSchema.extend({
  OFF_PAGE_SEO_SPREADSHEET_ID: z.string().trim().min(1),
});
export type OffPageSeoGoogleSheetsEnvironment = z.infer<typeof offPageSeoGoogleSheetsEnvironmentSchema>;
export function readOffPageSeoGoogleSheetsEnvironment(source: EnvironmentSource = process.env): OffPageSeoGoogleSheetsEnvironment {
  return offPageSeoGoogleSheetsEnvironmentSchema.parse(source);
}

export type GoogleSheetsServiceAccountEnvironment = z.infer<
  typeof googleSheetsServiceAccountEnvironmentSchema
>;
/** Backward-compatible Podcast environment name used by the shipped source and its tests. */
export type GoogleSheetsEnvironment = z.infer<typeof googleSheetsEnvironmentSchema>;
export type ContentGoogleSheetsEnvironment = z.infer<typeof contentGoogleSheetsEnvironmentSchema>;
export type OnPageSeoGoogleSheetsEnvironment = z.infer<
  typeof onPageSeoGoogleSheetsEnvironmentSchema
>;
export type GmbManagementGoogleSheetsEnvironment = z.infer<
  typeof gmbManagementGoogleSheetsEnvironmentSchema
>;
export type YoutubeSeoGoogleSheetsEnvironment = z.infer<
  typeof youtubeSeoGoogleSheetsEnvironmentSchema
>;
export type WebsiteBuilderGoogleSheetsEnvironment = z.infer<
  typeof websiteBuilderGoogleSheetsEnvironmentSchema
>;
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

export function readOnPageSeoGoogleSheetsEnvironment(
  source: EnvironmentSource = process.env,
): OnPageSeoGoogleSheetsEnvironment {
  return onPageSeoGoogleSheetsEnvironmentSchema.parse(source);
}

export function isOnPageSeoWorkflowSourceConfigured(
  source: EnvironmentSource = process.env,
): boolean {
  return onPageSeoGoogleSheetsEnvironmentSchema.safeParse(source).success;
}


export function readGmbManagementGoogleSheetsEnvironment(
  source: EnvironmentSource = process.env,
): GmbManagementGoogleSheetsEnvironment {
  return gmbManagementGoogleSheetsEnvironmentSchema.parse(source);
}

export function isGmbManagementWorkflowSourceConfigured(
  source: EnvironmentSource = process.env,
): boolean {
  return gmbManagementGoogleSheetsEnvironmentSchema.safeParse(source).success;
}

export function readYoutubeSeoGoogleSheetsEnvironment(
  source: EnvironmentSource = process.env,
): YoutubeSeoGoogleSheetsEnvironment {
  return youtubeSeoGoogleSheetsEnvironmentSchema.parse(source);
}

export function isYoutubeSeoWorkflowSourceConfigured(
  source: EnvironmentSource = process.env,
): boolean {
  return youtubeSeoGoogleSheetsEnvironmentSchema.safeParse(source).success;
}

export function readWebsiteBuilderGoogleSheetsEnvironment(
  source: EnvironmentSource = process.env,
): WebsiteBuilderGoogleSheetsEnvironment {
  return websiteBuilderGoogleSheetsEnvironmentSchema.parse(source);
}

export function isWebsiteBuilderWorkflowSourceConfigured(
  source: EnvironmentSource = process.env,
): boolean {
  return websiteBuilderGoogleSheetsEnvironmentSchema.safeParse(source).success;
}
