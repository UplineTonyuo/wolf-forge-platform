"use server";

import { revalidatePath } from "next/cache";
import { toClientSafeError } from "../../lib/errors/application-error";
import { getInternalContext } from "../../lib/supabase/next-server";

export type CompanyMutationResult = { ok: true } | { ok: false; error: string };

function refreshCompany(companyId: string) {
  revalidatePath("/companies");
  revalidatePath(`/companies/${companyId}`);
}

export async function updateCompanyAction(
  companyId: string,
  name: string,
): Promise<CompanyMutationResult> {
  const context = await getInternalContext();

  try {
    await context.services.permissions.requireModuleAccess("clients");
    if (!context.user.clients.edit) {
      return { ok: false, error: "You do not have permission to edit Companies." };
    }

    await context.services.organizations.update(companyId, name, context.actor);
    refreshCompany(companyId);
    return { ok: true };
  } catch (error) {
    const safe = toClientSafeError(error);
    return {
      ok: false,
      error: safe.code === "VALIDATION_ERROR"
        ? "Enter a company name with 200 characters or fewer."
        : safe.message,
    };
  }
}

/** Links an existing person to a Company. Membership is explicit; nothing is created or inferred. */
export async function addCompanyPersonAction(
  companyId: string,
  contactId: string,
): Promise<CompanyMutationResult> {
  const context = await getInternalContext();

  try {
    await context.services.permissions.requireModuleAccess("clients");
    if (!context.user.clients.create || !context.user.clients.privateManage) {
      return { ok: false, error: "You do not have permission to add Company people." };
    }

    await context.services.organizations.addMember(companyId, contactId, context.actor);
    refreshCompany(companyId);
    return { ok: true };
  } catch (error) {
    const safe = toClientSafeError(error);
    return {
      ok: false,
      error: safe.code === "VALIDATION_ERROR" ? "Choose a person and try again." : safe.message,
    };
  }
}
