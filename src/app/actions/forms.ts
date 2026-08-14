"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type {
  AssignFormInput,
  CorrectFormSubmissionInput,
  CreateFormInput,
  SubmitFormInput,
  UpdateFormDraftInput,
} from "../../domain/forms/schema";
import { submitFormSchema } from "../../domain/forms/schema";
import { parseInput } from "../../domain/shared";
import { toClientSafeError } from "../../lib/errors/application-error";
import { createNextServerSupabaseClient, getClientContext, getInternalContext } from "../../lib/supabase/next-server";
import { FormRepository } from "../../repositories/form-repository";

export type FormMutationResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function failure(error: unknown): { ok: false; error: string } {
  return { ok: false, error: toClientSafeError(error).message };
}

export async function createFormAction(input: CreateFormInput): Promise<FormMutationResult<{ id: string }>> {
  const context = await getInternalContext();
  if (!context.user.forms.manage) return { ok: false, error: "You do not have permission to create Forms." };
  try {
    const form = await context.services.forms.create(input, context.actor);
    revalidatePath("/forms");
    return { ok: true, data: { id: form.id } };
  } catch (error) {
    return failure(error);
  }
}

export async function saveFormDraftAction(
  formId: string,
  input: UpdateFormDraftInput,
): Promise<FormMutationResult<{ version: number }>> {
  const context = await getInternalContext();
  if (!context.user.forms.manage) return { ok: false, error: "You do not have permission to edit Forms." };
  try {
    const version = await context.services.forms.updateDraft(formId, input, context.actor);
    revalidatePath("/forms");
    revalidatePath(`/forms/${formId}`);
    return { ok: true, data: { version: version.version_number } };
  } catch (error) {
    return failure(error);
  }
}

export async function publishFormAction(formId: string, requestId: string): Promise<FormMutationResult<{ version: number }>> {
  const context = await getInternalContext();
  if (!context.user.forms.publish) return { ok: false, error: "You do not have permission to publish Forms." };
  try {
    const version = await context.services.forms.publish(formId, { request_id: requestId }, context.actor);
    revalidatePath("/forms");
    revalidatePath(`/forms/${formId}`);
    return { ok: true, data: { version: version.version_number } };
  } catch (error) {
    return failure(error);
  }
}

export async function archiveFormAction(formId: string, requestId: string): Promise<FormMutationResult> {
  const context = await getInternalContext();
  if (!context.user.forms.manage) return { ok: false, error: "You do not have permission to archive Forms." };
  try {
    await context.services.forms.archive(formId, { request_id: requestId }, context.actor);
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/forms");
  redirect("/forms?archived=1");
}

export async function assignFormAction(formId: string, input: AssignFormInput): Promise<FormMutationResult<{ id: string }>> {
  const context = await getInternalContext();
  if (!context.user.forms.assign) return { ok: false, error: "You do not have permission to assign Forms." };
  try {
    const assignment = await context.services.forms.assign(formId, input, context.actor);
    revalidatePath("/forms");
    revalidatePath("/account/forms");
    return { ok: true, data: { id: assignment.id } };
  } catch (error) {
    return failure(error);
  }
}

export async function submitAssignedFormAction(input: SubmitFormInput): Promise<FormMutationResult<{ id: string }>> {
  const context = await getClientContext();
  try {
    const submission = await context.services.forms.submit(input, context.actor);
    revalidatePath("/account/forms");
    return { ok: true, data: { id: submission.id } };
  } catch (error) {
    return failure(error);
  }
}

export async function submitPublicFormAction(input: SubmitFormInput): Promise<FormMutationResult<{ id: string }>> {
  try {
    const parsed = parseInput(submitFormSchema, input);
    const repository = new FormRepository(await createNextServerSupabaseClient());
    const submission = await repository.submit(parsed);
    return { ok: true, data: { id: submission.id } };
  } catch (error) {
    return failure(error);
  }
}

export async function correctFormSubmissionAction(
  submissionId: string,
  input: CorrectFormSubmissionInput,
): Promise<FormMutationResult<{ id: string }>> {
  const context = await getInternalContext();
  if (!context.user.forms.submissionsManage) {
    return { ok: false, error: "You do not have permission to correct Form submissions." };
  }
  try {
    const correction = await context.services.forms.correct(submissionId, input, context.actor);
    revalidatePath(`/forms/submissions/${submissionId}`);
    return { ok: true, data: { id: correction.id } };
  } catch (error) {
    return failure(error);
  }
}
