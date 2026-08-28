"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toClientSafeError } from "../../lib/errors/application-error";
import { enforceServerCostLimit } from "../../lib/security/server-cost-limit";
import { AuthAdminError } from "../../lib/supabase/auth-admin";
import { getAccountProvisioningService, getInternalContext } from "../../lib/supabase/next-server";

/**
 * Wolf Forge member access, kept deliberately separate from the client portal
 * path in src/app/actions/client-account-provisioning.ts. Client accounts are a
 * different account class with a different authorization boundary, so the two
 * never share an entry point.
 *
 * Owner is not offered here. Assigning it is possible only through the existing
 * preset boundary and only for a caller who already holds
 * users.manage_permissions.
 */
const assignablePresets = ["admin", "manager", "staff"] as const;

type AssignablePreset = (typeof assignablePresets)[number];

export type ProvisionInternalMemberState = {
  error: string | null;

  fieldErrors: {
    email?: string;
    firstName?: string;
    lastName?: string;
    preset?: string;
    password?: string;
    confirmPassword?: string;
  };
};

export type MemberAccessResult = { ok: true } | { ok: false; error: string };

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optionalText(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isAssignablePreset(value: string): value is AssignablePreset {
  return (assignablePresets as readonly string[]).includes(value);
}

/**
 * browser form -> this action -> AuthAdminAdapter (server-only auth user)
 * -> AccountProvisioningService -> app_provision_internal_member_profile.
 *
 * The database re-authorizes every step against auth.uid(); the checks here only
 * keep the form from starting a request that cannot succeed, and give the person
 * filling it in a useful message.
 */
export async function provisionInternalMemberAction(
  _state: ProvisionInternalMemberState,
  formData: FormData,
): Promise<ProvisionInternalMemberState> {
  const email = text(formData, "email").toLowerCase();
  const firstName = optionalText(formData, "first_name");
  const lastName = optionalText(formData, "last_name");
  const preset = text(formData, "preset_key");
  const password = String(formData.get("temporary_password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  const fieldErrors: ProvisionInternalMemberState["fieldErrors"] = {};

  if (!email) {
    fieldErrors.email = "Enter the member's email.";
  } else if (email.length > 320 || !validEmail(email)) {
    fieldErrors.email = "Enter a valid email address.";
  }

  if (firstName && firstName.length > 100) {
    fieldErrors.firstName = "First name must be 100 characters or fewer.";
  }

  if (lastName && lastName.length > 100) {
    fieldErrors.lastName = "Last name must be 100 characters or fewer.";
  }

  if (!preset) {
    fieldErrors.preset = "Choose a permission preset.";
  } else if (!isAssignablePreset(preset)) {
    fieldErrors.preset = "Choose Administrator, Manager, or Staff.";
  }

  if (!password) {
    fieldErrors.password = "Create a temporary password.";
  } else if (password.length < 8) {
    fieldErrors.password = "Use at least 8 characters.";
  } else if (password.length > 72) {
    fieldErrors.password = "Use 72 characters or fewer.";
  }

  if (confirmPassword !== password) {
    fieldErrors.confirmPassword = "Passwords do not match.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  let provisioningBoundary;

  try {
    provisioningBoundary = await getAccountProvisioningService();
  } catch {
    return {
      error: "Secure account provisioning is not configured on this server.",
      fieldErrors: {},
    };
  }

  const { context, provisioning } = provisioningBoundary;

  // app_provision_internal_member_profile requires both capabilities: users.create
  // to add an account at all, users.manage_permissions to give it a preset.
  const [createCheck, presetCheck] = await Promise.all([
    context.client.rpc("app_has_permission", { p_permission_key: "users.create" }),
    context.client.rpc("app_has_permission", { p_permission_key: "users.manage_permissions" }),
  ]);

  if (createCheck.error || presetCheck.error || !createCheck.data || !presetCheck.data) {
    return {
      error: "Only an authorized Wolf Forge administrator can add team members.",
      fieldErrors: {},
    };
  }

  try {
    await enforceServerCostLimit({
      actorId: context.actor.id,
      action: "account.provision",
    });
    await provisioning.provisionInternalMember(
      {
        email,
        first_name: firstName,
        last_name: lastName,
        temporary_password: password,
        preset_key: preset,
      },
      context.actor,
    );
  } catch (error) {
    if (error instanceof AuthAdminError && error.failure.reason === "already_exists") {
      return {
        error: null,
        fieldErrors: { email: "An account with this email already exists." },
      };
    }

    if (error instanceof AuthAdminError) {
      return { error: "The member login could not be created.", fieldErrors: {} };
    }

    const safe = toClientSafeError(error);

    return {
      error:
        safe.code === "VALIDATION_ERROR"
          ? "Check the member information and try again."
          : safe.message || "The member account could not be created.",
      fieldErrors: {},
    };
  }

  revalidatePath("/team");
  redirect("/team?created=1");
}

/**
 * Changes an existing member between the internal presets. Every restriction
 * that matters — users.manage_permissions, the self-edit block, owner
 * protection, account-class crossing, and keeping at least one account able to
 * manage permissions — is enforced inside app_set_profile_permission_preset.
 * public.profiles.role_id is never written from application code.
 */
export async function setMemberPresetAction(input: {
  profileId: string;
  presetKey: string;
}): Promise<MemberAccessResult> {
  const context = await getInternalContext();

  if (!isAssignablePreset(input.presetKey)) {
    return { ok: false, error: "Choose Administrator, Manager, or Staff." };
  }

  try {
    await context.services.permissions.setPreset(
      { profile_id: input.profileId, preset_key: input.presetKey },
      context.actor,
    );
  } catch (error) {
    return { ok: false, error: toClientSafeError(error).message };
  }

  revalidatePath("/team");
  return { ok: true };
}

/**
 * Grants or revokes "Send reports anytime" (reports.send_anytime) for one
 * non-owner internal member.
 *
 * The database is the authority: app_grant_report_send_anytime /
 * app_revoke_report_send_anytime independently require
 * users.manage_permissions, refuse a caller acting on themself and refuse an
 * Owner target — this action does not duplicate those checks, only surfaces
 * whatever the database decided.
 */
export async function setReportSendAnytimeAction(input: {
  profileId: string;
  allowed: boolean;
}): Promise<MemberAccessResult> {
  const context = await getInternalContext();

  try {
    if (input.allowed) {
      await context.services.permissions.grantReportSendAnytime(input.profileId, context.actor);
    } else {
      await context.services.permissions.revokeReportSendAnytime(input.profileId, context.actor);
    }
  } catch (error) {
    return { ok: false, error: toClientSafeError(error).message };
  }

  revalidatePath("/team");
  return { ok: true };
}
