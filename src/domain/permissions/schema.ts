import { z } from "zod";
import type { ProfileRow } from "../../lib/supabase/database-rows";
import { nonBlankTextSchema, uuidSchema } from "../shared";

/**
 * Wolf Forge staff access and client portal access are separate security
 * domains. An account class is never changed by a permission edit; it is
 * decided once by the provisioning path that created the account.
 */
export const accountClassSchema = z.enum(["internal", "client"]);
export type AccountClass = z.infer<typeof accountClassSchema>;

export const internalPresetKeySchema = z.enum(["owner", "admin", "manager", "staff"]);
export const clientPresetKeySchema = z.enum(["client"]);
export const presetKeySchema = z.union([internalPresetKeySchema, clientPresetKeySchema]);

export type InternalPresetKey = z.infer<typeof internalPresetKeySchema>;
export type ClientPresetKey = z.infer<typeof clientPresetKeySchema>;
export type PresetKey = z.infer<typeof presetKeySchema>;

/** Capability keys follow the existing `category.action` catalog format. */
export const permissionKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, "Enter a valid capability key.");

export const moduleKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*$/, "Enter a valid module key.");

/**
 * Absence of an override means the preset grant is inherited. An override is
 * always an explicit allow or deny.
 */
export const permissionOverrideSchema = z.object({
  permission_key: permissionKeySchema,
  allowed: z.boolean(),
});

export const permissionOverrideListSchema = z
  .array(permissionOverrideSchema)
  .max(200)
  .superRefine((overrides, context) => {
    const seen = new Set<string>();
    for (const override of overrides) {
      if (seen.has(override.permission_key)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate permission override: ${override.permission_key}`,
        });
      }
      seen.add(override.permission_key);
    }
  });

export type PermissionOverrideInput = z.infer<typeof permissionOverrideSchema>;

export const setProfilePresetSchema = z.object({
  profile_id: uuidSchema,
  preset_key: presetKeySchema,
});

export const setProfileOverrideSchema = z.object({
  profile_id: uuidSchema,
  permission_key: permissionKeySchema,
  allowed: z.boolean(),
});

export const clearProfileOverrideSchema = z.object({
  profile_id: uuidSchema,
  permission_key: permissionKeySchema,
});

export type SetProfilePresetInput = z.infer<typeof setProfilePresetSchema>;
export type SetProfileOverrideInput = z.infer<typeof setProfileOverrideSchema>;
export type ClearProfileOverrideInput = z.infer<typeof clearProfileOverrideSchema>;

// -----------------------------------------------------------------------------
// Provisioning
// -----------------------------------------------------------------------------

const emailSchema = z.email().max(320).transform((value) => value.toLowerCase());
const personNameSchema = nonBlankTextSchema.max(100);

/**
 * Temporary passwords are never logged, never returned, and never stored by the
 * application; they are handed straight to the server-only auth admin boundary.
 */
const temporaryPasswordSchema = z.string().min(8).max(72);

const provisioningIdentitySchema = z.object({
  email: emailSchema,
  first_name: personNameSchema.nullable().optional(),
  last_name: personNameSchema.nullable().optional(),
  display_name: nonBlankTextSchema.max(200).nullable().optional(),
  temporary_password: temporaryPasswordSchema,
  overrides: permissionOverrideListSchema.optional(),
});

export const provisionInternalMemberSchema = provisioningIdentitySchema.extend({
  preset_key: internalPresetKeySchema,
});

export const provisionClientAccountSchema = provisioningIdentitySchema.extend({
  // Omitted when the client sets their own password from the welcome email (KI-091).
  temporary_password: temporaryPasswordSchema.optional(),
  preset_key: clientPresetKeySchema.optional(),
  company_id: uuidSchema.optional(),
  company_name: nonBlankTextSchema.max(200).optional(),
  phone: nonBlankTextSchema.max(50).nullable().optional(),
  job_title: nonBlankTextSchema.max(120).nullable().optional(),
  company_request_id: uuidSchema.optional(),
  contact_request_id: uuidSchema.optional(),
}).refine(
  (value) => Boolean(value.company_id ?? value.company_name),
  "Supply an existing company or a company name.",
);

export type ProvisionInternalMemberInput = z.infer<typeof provisionInternalMemberSchema>;
export type ProvisionClientAccountInput = z.infer<typeof provisionClientAccountSchema>;

// -----------------------------------------------------------------------------
// Read models
// -----------------------------------------------------------------------------

export type EffectivePermission = {
  permission_key: string;
  category: string;
  allowed: boolean;
  source: "preset" | "override";
};

export type PermissionPreset = {
  preset_id: string;
  preset_key: string;
  preset_name: string;
  account_class: AccountClass;
  system_managed: boolean;
  sort_order: number;
};

export type ProfilePermissionSummary = {
  profile_id: string;
  display_name: string | null;
  preset_key: string;
  preset_name: string;
  account_class: AccountClass;
  company_id: string | null;
  override_count: number;
};

export type ModuleAccess = {
  module_key: string;
  label: string;
  account_class: AccountClass;
  required_permission_key: string;
  granted: boolean;
};

/**
 * The internal employee directory. Client portal accounts are a separate
 * security domain and are excluded by the read boundary itself, not by a filter
 * the caller could forget.
 */
export type InternalMember = {
  profile_id: string;
  display_name: string | null;
  email: string | null;
  preset_key: string;
  preset_name: string;
  sort_order: number;
  override_count: number;
  is_self: boolean;
  created_at: string;
  /** Public avatar URL from public.profiles, or null when initials are shown. */
  avatar_url: string | null;
  /** Resolved reports.send_anytime — true for Owner unconditionally, or an explicit override. */
  report_send_anytime: boolean;
};

export type PermissionPresetOverview = {
  preset_key: string;
  preset_name: string;
  account_class: AccountClass;
  sort_order: number;
  member_count: number;
  granted_permission_count: number;
  total_permission_count: number;
};

export type PermissionPresetGrant = {
  preset_key: string;
  permission_key: string;
  category: string;
  label: string;
  description: string;
  allowed: boolean;
};

export type ProvisionedAccount = {
  profile: ProfileRow;
  companyId: string | null;
};

/** Module visibility is derived from a real capability, never a separate flag. */
export function toModuleAccessMap(modules: ModuleAccess[]): Record<string, boolean> {
  return Object.fromEntries(modules.map((module) => [module.module_key, module.granted]));
}
