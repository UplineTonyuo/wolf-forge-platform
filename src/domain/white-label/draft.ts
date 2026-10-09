import { z } from "zod";
import { uuidSchema } from "../shared";
import { WHITE_LABEL_MODULES, type WhiteLabelPreviewState } from "./preview";

/*
 * WL-2.33: a persisted per-Tenant White Label DRAFT (private.tenant_white_label_drafts).
 * Saving a draft publishes nothing; no authorization path reads it. The
 * database re-validates everything below (constraints + trigger) and checks
 * the Platform Admin entitlement on every read and write.
 */

export const DISPLAY_NAME_MAX = 60;

export type WhiteLabelTenantStatus = "active" | "suspended" | "archived";

export type WhiteLabelTenant = {
  id: string;
  slug: string;
  displayName: string;
  status: WhiteLabelTenantStatus;
  /** Null until the Tenant's first draft is saved. */
  draftRevision: number | null;
};

export type WhiteLabelDraft = {
  tenantId: string;
  tenantStatus: WhiteLabelTenantStatus;
  state: WhiteLabelPreviewState;
  /** 0 = nothing saved yet; the state holds the documented defaults. */
  revision: number;
  updatedAt: string | null;
};

export type SavedWhiteLabelDraft = { revision: number; updatedAt: string };

const moduleIds = WHITE_LABEL_MODULES.map((module) => module.id) as [string, ...string[]];

/** The selected, configurable modules as the stored sorted set. */
export function draftModuleKeys(modules: Record<string, boolean>): string[] {
  return moduleIds.filter((id) => modules[id] === true).sort();
}

export function modulesFromKeys(keys: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(moduleIds.map((id) => [id, keys.includes(id)]));
}

/** First reason the draft cannot be saved, worded for the builder; null when valid. */
export function draftProblem(state: WhiteLabelPreviewState): string | null {
  const name = state.displayName.trim();
  if (!name) return "Enter a workspace display name.";
  if (name.length > DISPLAY_NAME_MAX) return `Keep the display name to ${DISPLAY_NAME_MAX} characters.`;
  if (/\p{Cc}/u.test(name)) return "The display name contains characters that cannot be shown.";
  if (![state.primaryColor, state.accentColor].every((color) => /^#[0-9a-f]{6}$/i.test(color))) {
    return "Choose valid colors.";
  }
  for (const entry of WHITE_LABEL_MODULES) {
    if (state.modules[entry.id] !== true) continue;
    const missing = entry.requires.find((required) => state.modules[required] !== true);
    const label = WHITE_LABEL_MODULES.find((candidate) => candidate.id === missing)?.label;
    if (label) return `${entry.label} needs ${label}. Turn ${label} on, or turn ${entry.label} off.`;
  }
  return null;
}

export const saveWhiteLabelDraftSchema = z
  .object({
    tenantId: uuidSchema,
    expectedRevision: z.number().int().min(0),
    displayName: z.string().max(200),
    primaryColor: z.string().max(7),
    accentColor: z.string().max(7),
    // Operations (todo) and unknown ids are not in the enum, so never accepted.
    moduleKeys: z.array(z.enum(moduleIds)).max(moduleIds.length),
  })
  .strict()
  .superRefine((input, context) => {
    const problem = draftProblem({
      displayName: input.displayName,
      primaryColor: input.primaryColor,
      accentColor: input.accentColor,
      modules: modulesFromKeys(input.moduleKeys),
    });
    if (problem) context.addIssue({ code: "custom", message: problem });
  });

export type SaveWhiteLabelDraftInput = z.infer<typeof saveWhiteLabelDraftSchema>;
