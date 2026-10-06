"use server";

import { revalidatePath } from "next/cache";
import { toClientSafeError } from "../../lib/errors/application-error";
import { getInternalContext } from "../../lib/supabase/next-server";

export type CompanyMutationResult = { ok: true } | { ok: false; error: string };

function refreshCompany(companyId: string) {
  revalidatePath("/companies");
  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/clients");
  revalidatePath(`/clients/${companyId}`);
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

    await context.services.companies.update(companyId, { name }, context.actor);
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

export async function addCompanyPersonAction(
  companyId: string,
  input: {
    requestId: string;
    name: string;
    email: string;
    phone: string;
    jobTitle: string;
  },
): Promise<CompanyMutationResult> {
  const context = await getInternalContext();

  try {
    await context.services.permissions.requireModuleAccess("clients");
    if (!context.user.clients.create || !context.user.clients.privateManage) {
      return { ok: false, error: "You do not have permission to add Company people." };
    }

    const contacts = await context.services.contacts.listForCompany(companyId);
    const email = input.email.trim().toLowerCase();
    if (email && contacts.some((contact) => contact.email?.trim().toLowerCase() === email)) {
      return { ok: false, error: "A person with that email is already linked to this Company." };
    }

    await context.services.contacts.create(
      {
        request_id: input.requestId,
        company_id: companyId,
        name: input.name,
        email: email || null,
        phone: input.phone || null,
        job_title: input.jobTitle || null,
        is_primary: contacts.length === 0,
      },
      context.actor,
    );

    refreshCompany(companyId);
    return { ok: true };
  } catch (error) {
    const safe = toClientSafeError(error);
    return {
      ok: false,
      error: safe.code === "VALIDATION_ERROR"
        ? "Check the person details and try again."
        : safe.message,
    };
  }
}
