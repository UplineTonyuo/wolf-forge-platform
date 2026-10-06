"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  companyStatuses,
  createCompanySchema,
  type CompanyStatus,
} from "../../domain/companies/schema";
import { toClientSafeError } from "../../lib/errors/application-error";
import { clientNameSearchScore } from "../../lib/client-name-search";
import { getInternalContext } from "../../lib/supabase/next-server";

export type CreateCompanyState = {
  error: string | null;
  fieldError: string | null;
  duplicate: { id: string; name: string } | null;
};

export async function createCompanyAction(
  _state: CreateCompanyState,
  formData: FormData,
): Promise<CreateCompanyState> {
  const context = await getInternalContext();

  try {
    await context.services.permissions.requireModuleAccess("clients");
  } catch (error) {
    return {
      error: toClientSafeError(error).message,
      fieldError: null,
      duplicate: null,
    };
  }

  if (!context.user.clients.create) {
    return {
      error: "You do not have permission to create Companies.",
      fieldError: null,
      duplicate: null,
    };
  }

  const rawName = String(formData.get("name") ?? "");
  const parsed = createCompanySchema.safeParse({
    request_id: formData.get("request_id"),
    name: rawName,
  });

  if (!parsed.success) {
    const nameIssue = parsed.error.issues.some(
      (issue) => issue.path[0] === "name",
    );

    return {
      error: nameIssue ? null : "Refresh the page and try again.",
      fieldError: nameIssue
        ? rawName.trim()
          ? "Company name must be 200 characters or fewer."
          : "Enter a company name."
        : null,
      duplicate: null,
    };
  }

  let createdId: string;

  try {
    // Company / Team names are compared only with other Companies, never with
    // Client business names.
    const duplicate = (await context.services.organizations.listActive()).find(
      (company) => clientNameSearchScore(company.name, parsed.data.name) === 1000,
    );

    if (duplicate) {
      return {
        error: null,
        fieldError: null,
        duplicate: { id: duplicate.id, name: duplicate.name },
      };
    }

    const company = await context.services.organizations.create(
      parsed.data,
      context.actor,
    );

    createdId = (await context.services.organizations.get(company.id)).id;
  } catch (error) {
    const safe = toClientSafeError(error);

    return {
      error:
        safe.code === "VALIDATION_ERROR"
          ? "Check the company information and try again."
          : safe.message,
      fieldError: null,
      duplicate: null,
    };
  }

  revalidatePath("/companies");
  revalidatePath(`/companies/${createdId}`);
  redirect(`/companies/${createdId}?created=1`);
}

export type CreateClientState = {
  error: string | null;
  fieldError: string | null;
};

function optionalText(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

export async function createClientAction(
  _state: CreateClientState,
  formData: FormData,
): Promise<CreateClientState> {
  const companyName = String(
    formData.get("name") ?? "",
  ).trim();

  const requestId = String(
    formData.get("request_id") ?? "",
  );

  const firstName = optionalText(
    formData,
    "first_name",
  );

  const lastName = optionalText(
    formData,
    "last_name",
  );

  const email = optionalText(
    formData,
    "email",
  );

  const phone = optionalText(
    formData,
    "phone",
  );

  const jobTitle = optionalText(
    formData,
    "job_title",
  );

  if (!companyName) {
    return {
      error: null,
      fieldError: "Enter a company name.",
    };
  }

  const context = await getInternalContext();

  try {
    await context.services.permissions.requireModuleAccess("clients");
  } catch (error) {
    return {
      error: toClientSafeError(error).message,
      fieldError: null,
    };
  }

  if (!context.user.clients.create) {
    return {
      error: "You do not have permission to create Clients.",
      fieldError: null,
    };
  }

  const contactName = [firstName, lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const hasContactInformation = Boolean(
    contactName || email || phone || jobTitle,
  );

  if (hasContactInformation && !context.user.clients.privateManage) {
    return {
      error: "You do not have permission to manage client-private contact data.",
      fieldError: null,
    };
  }

  let createdId: string;

  try {
    const company =
      await context.services.companies.create(
        {
          request_id: requestId,
          name: companyName,
        },
        context.actor,
      );

    createdId = company.id;

    if (hasContactInformation) {
      await context.services.contacts.create(
        {
          company_id: company.id,
          name:
            contactName ||
            email ||
            phone ||
            "Primary contact",
          email,
          phone,
          job_title: jobTitle,
          is_primary: true,
        },
        context.actor,
      );
    }
  } catch (error) {
    const safe = toClientSafeError(error);

    return {
      error:
        safe.code === "VALIDATION_ERROR"
          ? "Check the account information and try again."
          : safe.message,
      fieldError: null,
    };
  }

  revalidatePath("/clients");

  redirect(
    `/clients/${createdId}?created=1`,
  );
}

export type UpdateClientStatusResult =
  | {
      ok: true;
      status: string;
    }
  | {
      ok: false;
      error: string;
    };

export async function updateClientStatusAction(
  companyId: string,
  status: string,
): Promise<UpdateClientStatusResult> {
  const context = await getInternalContext();

  try {
    await context.services.permissions.requireModuleAccess("clients");
    if (!context.user.clients.edit) {
      return {
        ok: false,
        error: "You do not have permission to edit Clients.",
      };
    }

    const company =
      await context.services.companies.update(
        companyId,
        { status },
        context.actor,
      );

    revalidatePath("/clients");
    revalidatePath(`/clients/${companyId}`);

    return {
      ok: true,
      status: company.status,
    };
  } catch (error) {
    const safe = toClientSafeError(error);

    return {
      ok: false,
      error:
        safe.code === "VALIDATION_ERROR"
          ? "Choose a valid client status."
          : safe.message,
    };
  }
}

export type UpdateClientDetailsResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateClientDetailsAction(
  companyId: string,
  contactId: string | null,
  input: {
    name: string;
    status: string;
    contact: {
      name: string;
      email: string;
      phone: string;
      job_title: string;
    } | null;
  },
): Promise<UpdateClientDetailsResult> {
  const context = await getInternalContext();

  try {
    await context.services.permissions.requireModuleAccess("clients");

    if (!context.user.clients.edit) {
      return {
        ok: false,
        error: "You do not have permission to edit Clients.",
      };
    }

    if (input.contact && !context.user.clients.privateManage) {
      return {
        ok: false,
        error: "You do not have permission to manage client-private contact data.",
      };
    }

    await context.services.companies.update(
      companyId,
      { name: input.name, status: input.status as CompanyStatus },
      context.actor,
    );

    if (input.contact && contactId) {
      await context.services.contacts.update(
        contactId,
        {
          name: input.contact.name,
          email: input.contact.email || null,
          phone: input.contact.phone || null,
          job_title: input.contact.job_title || null,
        },
        context.actor,
      );
    }

    revalidatePath("/clients");
    revalidatePath(`/clients/${companyId}`);

    return { ok: true };
  } catch (error) {
    const safe = toClientSafeError(error);

    return {
      ok: false,
      error:
        safe.code === "VALIDATION_ERROR"
          ? "Check the client details and try again."
          : safe.message,
    };
  }
}

export type ClientBulkOutcome = {
  id: string;
  label: string;
  error?: string;
};

export type ClientBulkResult = {
  attempted: number;
  succeeded: ClientBulkOutcome[];
  failed: ClientBulkOutcome[];
};

type InternalContext = Awaited<ReturnType<typeof getInternalContext>>;

function clientMutationError(error: unknown, validationMessage: string) {
  const safe = toClientSafeError(error);

  if (safe.code === "VALIDATION_ERROR") return validationMessage;
  if (safe.code === "PERMISSION_DENIED") {
    return "You do not have permission to perform this action.";
  }
  if (safe.code === "NOT_FOUND") return "That client is no longer available.";
  return safe.message;
}

function failedClientBatch(companyIds: string[], error: string): ClientBulkResult {
  const unique = Array.from(new Set(companyIds.filter(Boolean)));

  return {
    attempted: unique.length,
    succeeded: [],
    failed: unique.map((id) => ({ id, label: "Unavailable client", error })),
  };
}

async function runClientBatch(
  context: InternalContext,
  companyIds: string[],
  validationMessage: string,
  operation: (companyId: string) => Promise<unknown>,
): Promise<ClientBulkResult> {
  const unique = Array.from(new Set(companyIds.filter(Boolean)));
  const labels = new Map<string, string>();

  try {
    for (const client of await context.services.companies.listActive()) {
      labels.set(client.id, client.name);
    }
  } catch {
    // A failed label lookup must not hide the real per-client mutation result.
  }

  const result: ClientBulkResult = {
    attempted: unique.length,
    succeeded: [],
    failed: [],
  };

  for (const companyId of unique) {
    const label = labels.get(companyId) ?? "Unavailable client";

    try {
      await operation(companyId);
      result.succeeded.push({ id: companyId, label });
    } catch (error) {
      result.failed.push({
        id: companyId,
        label,
        error: clientMutationError(error, validationMessage),
      });
    }
  }

  revalidatePath("/clients");
  for (const outcome of result.succeeded) {
    revalidatePath(`/clients/${outcome.id}`);
  }

  return result;
}

export async function bulkChangeClientStatusAction(
  companyIds: string[],
  status: string,
): Promise<ClientBulkResult> {
  if (!(companyStatuses as readonly string[]).includes(status)) {
    return failedClientBatch(companyIds, "Choose a valid client status.");
  }

  const context = await getInternalContext();

  try {
    await context.services.permissions.requireModuleAccess("clients");

    if (!context.user.clients.edit) {
      return failedClientBatch(
        companyIds,
        "You do not have permission to edit Clients.",
      );
    }
  } catch (error) {
    return failedClientBatch(companyIds, clientMutationError(error, "That status change was rejected."));
  }

  return runClientBatch(
    context,
    companyIds,
    "That status change was rejected.",
    (companyId) =>
      context.services.companies.update(
        companyId,
        { status: status as CompanyStatus },
        context.actor,
      ),
  );
}

export async function bulkArchiveClientsAction(
  companyIds: string[],
): Promise<ClientBulkResult> {
  const context = await getInternalContext();

  try {
    await context.services.permissions.requireModuleAccess("clients");

    if (!context.user.clients.archive) {
      return failedClientBatch(
        companyIds,
        "You do not have permission to delete Clients.",
      );
    }
  } catch (error) {
    return failedClientBatch(
      companyIds,
      clientMutationError(error, "That client could not be deleted."),
    );
  }

  return runClientBatch(
    context,
    companyIds,
    "That client could not be deleted.",
    (companyId) => context.services.companies.archive(companyId, context.actor),
  );
}


export type AdjustClientBalanceResult =
  | {
      ok: true;
      balanceCents: number;
    }
  | {
      ok: false;
      error: string;
    };

function parseUsdAmountToCents(
  value: string,
): number | null {
  const normalized =
    value.trim();

  if (
    !/^\d{1,10}(\.\d{1,2})?$/.test(
      normalized,
    )
  ) {
    return null;
  }

  const [whole, fraction = ""] =
    normalized.split(".");

  const dollars = Number(whole);

  const cents =
    Number(
      fraction.padEnd(2, "0"),
    );

  const total =
    dollars * 100 + cents;

  if (
    !Number.isSafeInteger(total) ||
    total <= 0
  ) {
    return null;
  }

  return total;
}

export async function adjustClientBalanceAction(
  companyId: string,
  direction: "credit" | "debit",
  amount: string,
  reason: string,
  requestId: string,
): Promise<AdjustClientBalanceResult> {
  const parsed =
    parseUsdAmountToCents(amount);

  if (parsed === null) {
    return {
      ok: false,
      error:
        "Enter a valid amount, for example 100 or 100.50.",
    };
  }

  const normalizedReason =
    reason.trim();

  if (
    normalizedReason.length > 240
  ) {
    return {
      ok: false,
      error:
        "Reason must be 240 characters or fewer.",
    };
  }

  const amountCents =
    direction === "credit"
      ? parsed
      : -parsed;

  const context =
    await getInternalContext();

  try {
    await context.services.permissions.requireModuleAccess("clients");
    if (!context.user.clients.privateManage) {
      return {
        ok: false,
        error: "You do not have permission to manage client balances.",
      };
    }

    const transaction =
      await context.services.wallets.adjust(
        {
          request_id: requestId,
          company_id: companyId,
          amount_cents: amountCents,
          reason:
            normalizedReason || null,
        },
        context.actor,
      );

    revalidatePath(
      `/clients/${companyId}`,
    );

    revalidatePath("/clients");

    return {
      ok: true,
      balanceCents:
        Number(
          transaction.balance_after_cents,
        ),
    };
  } catch (error) {
    const rawMessage =
      error instanceof Error
        ? error.message.toLowerCase()
        : "";

    if (
      rawMessage.includes(
        "insufficient client balance",
      )
    ) {
      return {
        ok: false,
        error:
          "This deduction would make the client balance negative.",
      };
    }

    const safe =
      toClientSafeError(error);

    return {
      ok: false,
      error:
        safe.code ===
        "VALIDATION_ERROR"
          ? "Check the balance adjustment and try again."
          : safe.message,
    };
  }
}
