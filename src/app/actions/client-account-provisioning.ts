"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toClientSafeError } from "../../lib/errors/application-error";
import { enforceServerCostLimit } from "../../lib/security/server-cost-limit";
import { AuthAdminError } from "../../lib/supabase/auth-admin";
import { getAccountProvisioningService } from "../../lib/supabase/next-server";

export type ProvisionClientAccountState = {
  error: string | null;

  fieldErrors: {
    email?: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    phone?: string;
    jobTitle?: string;
    password?: string;
    confirmPassword?: string;
  };
};

function text(
  formData: FormData,
  key: string,
) {
  return String(
    formData.get(key) ?? "",
  ).trim();
}

function optionalText(
  formData: FormData,
  key: string,
) {
  const value = text(
    formData,
    key,
  );

  return value || null;
}

function validEmail(
  value: string,
) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    value,
  );
}

function validRequestId(
  value: string,
) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function requestId(
  formData: FormData,
  key: string,
) {
  const supplied = text(
    formData,
    key,
  );

  return validRequestId(supplied)
    ? supplied
    : randomUUID();
}

export async function provisionClientAccountAction(
  _state: ProvisionClientAccountState,
  formData: FormData,
): Promise<ProvisionClientAccountState> {
  const email = text(
    formData,
    "email",
  ).toLowerCase();

  const firstName =
    optionalText(
      formData,
      "first_name",
    );

  const lastName =
    optionalText(
      formData,
      "last_name",
    );

  const companyName =
    text(
      formData,
      "company",
    );

  const phone =
    optionalText(
      formData,
      "phone",
    );

  const jobTitle =
    optionalText(
      formData,
      "job_title",
    );

  const password =
    String(
      formData.get(
        "temporary_password",
      ) ?? "",
    );

  const confirmPassword =
    String(
      formData.get(
        "confirm_password",
      ) ?? "",
    );

  const fieldErrors:
    ProvisionClientAccountState["fieldErrors"] =
      {};

  if (!email) {
    fieldErrors.email =
      "Enter the client's email.";
  } else if (
    email.length > 320 ||
    !validEmail(email)
  ) {
    fieldErrors.email =
      "Enter a valid email address.";
  }

  if (
    firstName &&
    firstName.length > 100
  ) {
    fieldErrors.firstName =
      "First name must be 100 characters or fewer.";
  }

  if (
    lastName &&
    lastName.length > 100
  ) {
    fieldErrors.lastName =
      "Last name must be 100 characters or fewer.";
  }

  if (!companyName) {
    fieldErrors.company =
      "Enter a company name.";
  } else if (
    companyName.length > 200
  ) {
    fieldErrors.company =
      "Company name must be 200 characters or fewer.";
  }

  if (
    phone &&
    phone.length > 50
  ) {
    fieldErrors.phone =
      "Phone must be 50 characters or fewer.";
  }

  if (
    jobTitle &&
    jobTitle.length > 120
  ) {
    fieldErrors.jobTitle =
      "Job title must be 120 characters or fewer.";
  }

  if (!password) {
    fieldErrors.password =
      "Create a temporary password.";
  } else if (
    password.length < 8
  ) {
    fieldErrors.password =
      "Use at least 8 characters.";
  } else if (
    password.length > 72
  ) {
    fieldErrors.password =
      "Use 72 characters or fewer.";
  }

  if (
    confirmPassword !== password
  ) {
    fieldErrors.confirmPassword =
      "Passwords do not match.";
  }

  if (
    Object.keys(
      fieldErrors,
    ).length > 0
  ) {
    return {
      error: null,
      fieldErrors,
    };
  }

  let provisioningBoundary;

  try {
    provisioningBoundary =
      await getAccountProvisioningService();
  } catch {
    return {
      error:
        "Secure account provisioning is not configured on this server.",
      fieldErrors: {},
    };
  }

  const {
    context,
    provisioning,
  } = provisioningBoundary;

  /*
   * Authorization is enforced again inside the database provisioning RPC
   * against auth.uid(). This check only keeps the form from starting a
   * request that cannot succeed.
   */
  const {
    data: canManageClientPrivate,
    error: permissionError,
  } = await context.client.rpc(
    "app_has_permission",
    {
      p_permission_key:
        "client_private.manage",
    },
  );

  if (
    permissionError ||
    !canManageClientPrivate
  ) {
    return {
      error:
        "Only an authorized Wolf Forge administrator can create client portal accounts.",
      fieldErrors: {},
    };
  }

  let companyId:
    string | null = null;

  try {
    await enforceServerCostLimit({
      actorId: context.actor.id,
      action: "account.provision",
    });
    const account =
      await provisioning.provisionClientAccount(
        {
          email,
          first_name: firstName,
          last_name: lastName,
          temporary_password: password,
          company_name: companyName,
          phone,
          job_title: jobTitle,

          company_request_id:
            requestId(
              formData,
              "company_request_id",
            ),

          contact_request_id:
            requestId(
              formData,
              "contact_request_id",
            ),
        },
        context.actor,
      );

    companyId =
      account.companyId;
  } catch (error) {
    if (
      error instanceof AuthAdminError &&
      error.failure.reason ===
        "already_exists"
    ) {
      return {
        error: null,

        fieldErrors: {
          email:
            "An account with this email already exists.",
        },
      };
    }

    if (
      error instanceof AuthAdminError
    ) {
      return {
        error:
          "The client login could not be created.",
        fieldErrors: {},
      };
    }

    const safe =
      toClientSafeError(error);

    return {
      error:
        safe.code ===
        "VALIDATION_ERROR"
          ? "Check the client information and try again."
          : safe.message ||
            "The client account could not be created.",

      fieldErrors: {},
    };
  }

  if (!companyId) {
    return {
      error:
        "The client company could not be created.",
      fieldErrors: {},
    };
  }

  revalidatePath(
    "/clients",
  );

  revalidatePath(
    `/clients/${companyId}`,
  );

  redirect(
    `/clients/${companyId}?created=1&portal=1`,
  );
}
