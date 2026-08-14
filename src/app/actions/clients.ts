"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toClientSafeError } from "../../lib/errors/application-error";
import { getInternalContext } from "../../lib/supabase/next-server";

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

    const contactName = [
      firstName,
      lastName,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

    const hasContactInformation = Boolean(
      contactName ||
      email ||
      phone ||
      jobTitle,
    );

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
