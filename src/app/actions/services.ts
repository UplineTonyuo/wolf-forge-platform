"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toClientSafeError } from "../../lib/errors/application-error";
import { getInternalContext } from "../../lib/supabase/next-server";

export type CatalogFormState = {
  error: string | null;
};

function optionalText(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function requiredNumber(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? Number.NaN : Number(value);
}

function optionalNumber(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : Number(value);
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function serviceInput(formData: FormData) {
  const recurring = checked(formData, "recurring");
  const deadlineAmount = optionalNumber(formData, "deadline_amount");

  return {
    name: String(formData.get("name") ?? "").trim(),
    folder_id: optionalText(formData, "folder_id"),
    description: optionalText(formData, "description"),
    price: requiredNumber(formData, "price"),
    currency: String(formData.get("currency") ?? "USD").trim().toUpperCase(),
    image_url: null,
    is_active: formData.get("is_active") !== "false",
    is_public: checked(formData, "is_public"),
    recurring,
    recurring_price: recurring ? optionalNumber(formData, "recurring_price") : null,
    recurring_interval_length: recurring
      ? optionalNumber(formData, "recurring_interval_length")
      : null,
    recurring_interval_unit: recurring
      ? optionalText(formData, "recurring_interval_unit")
      : null,
    recurring_action: recurring ? optionalText(formData, "recurring_action") : null,
    group_quantities: checked(formData, "group_quantities"),
    assigned_to_profile_id: optionalText(formData, "assigned_to_profile_id"),
    deadline_amount: deadlineAmount,
    deadline_unit: deadlineAmount == null ? null : optionalText(formData, "deadline_unit"),
    require_client_profile: checked(formData, "require_client_profile"),
    sort_order: requiredNumber(formData, "sort_order"),
  };
}

function folderInput(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    description: optionalText(formData, "description"),
    parent_id: optionalText(formData, "parent_id"),
    sort_order: requiredNumber(formData, "sort_order"),
  };
}

function formError(error: unknown): CatalogFormState {
  const safe = toClientSafeError(error);
  return {
    error: safe.code === "VALIDATION_ERROR"
      ? "Check the highlighted service settings and try again."
      : safe.message,
  };
}

export async function createServiceAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  void _state;
  const context = await getInternalContext();
  let serviceId: string;

  try {
    const service = await context.services.catalog.create({
      request_id: String(formData.get("request_id") ?? ""),
      ...serviceInput(formData),
    }, context.actor);
    serviceId = service.id;
  } catch (error) {
    return formError(error);
  }

  revalidatePath("/services");
  redirect(`/services/${serviceId}?created=1`);
}

export async function updateServiceAction(
  serviceId: string,
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  void _state;
  const context = await getInternalContext();
  try {
    await context.services.catalog.update(serviceId, serviceInput(formData), context.actor);
  } catch (error) {
    return formError(error);
  }

  revalidatePath("/services");
  revalidatePath(`/services/${serviceId}`);
  redirect(`/services/${serviceId}?saved=1`);
}

export async function duplicateServiceAction(
  serviceId: string,
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const context = await getInternalContext();
  let duplicateId: string;
  try {
    const duplicate = await context.services.catalog.duplicate(
      serviceId,
      String(formData.get("request_id") ?? ""),
      context.actor,
    );
    duplicateId = duplicate.id;
  } catch (error) {
    return formError(error);
  }

  revalidatePath("/services");
  redirect(`/services/${duplicateId}?duplicated=1`);
}

export async function archiveServiceAction(
  serviceId: string,
  _state: CatalogFormState,
  _formData: FormData,
): Promise<CatalogFormState> {
  void _state;
  void _formData;
  const context = await getInternalContext();
  try {
    await context.services.catalog.archive(serviceId, context.actor);
  } catch (error) {
    return formError(error);
  }

  revalidatePath("/services");
  redirect("/services?archived=1");
}

export async function createServiceFolderAction(
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const context = await getInternalContext();
  let folderId: string;
  try {
    const folder = await context.services.catalog.createFolder({
      request_id: String(formData.get("request_id") ?? ""),
      ...folderInput(formData),
    }, context.actor);
    folderId = folder.id;
  } catch (error) {
    return formError(error);
  }

  revalidatePath("/services");
  redirect(`/services?folder=${folderId}&folderCreated=1`);
}

export async function updateServiceFolderAction(
  folderId: string,
  _state: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const context = await getInternalContext();
  try {
    await context.services.catalog.updateFolder(folderId, folderInput(formData), context.actor);
  } catch (error) {
    return formError(error);
  }

  revalidatePath("/services");
  revalidatePath(`/services/folders/${folderId}`);
  redirect(`/services/folders/${folderId}?saved=1`);
}

export async function archiveServiceFolderAction(
  folderId: string,
  _state: CatalogFormState,
  _formData: FormData,
): Promise<CatalogFormState> {
  void _state;
  void _formData;
  const context = await getInternalContext();
  try {
    await context.services.catalog.archiveFolder(folderId, context.actor);
  } catch (error) {
    return formError(error);
  }

  revalidatePath("/services");
  redirect("/services?folderArchived=1");
}
