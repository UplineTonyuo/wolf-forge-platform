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
import { observeActionFailure } from "../../lib/security/observed-failure";
import { createNextServerSupabaseClient, getClientContext, getInternalContext } from "../../lib/supabase/next-server";
import { FormRepository } from "../../repositories/form-repository";
import { runIntakeSubmissionJob } from "../../lib/forms/intake-jobs";
import { clientOrderStartSchema } from "../../domain/orders/client-start";
import { invalidatePublicFormSchemas } from "../f/public-schema";
import { requirePublicFormHuman } from "../../lib/security/public-form-protection";

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
    invalidatePublicFormSchemas(context.user.tenantId);
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
    invalidatePublicFormSchemas(context.user.tenantId);
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
    revalidatePath("/account/onboarding");
    // The portal rail counts outstanding onboarding items, so a new assignment
    // has to invalidate the shell as well as the page.
    revalidatePath("/account");
    return { ok: true, data: { id: assignment.id } };
  } catch (error) {
    return failure(error);
  }
}

type AssignedSubmissionResult = { id: string; followUp?: string; orderStart?: { id: string; status: string; started: boolean; requested: boolean } };

export async function submitAssignedFormAction(input: SubmitFormInput, downloadReceipt = false): Promise<FormMutationResult<AssignedSubmissionResult>> {
  const context = await getClientContext();
  let result: AssignedSubmissionResult;
  let receiptPath: string | null = null;
  try {
    const parsed = parseInput(submitFormSchema, input);
    const submission = await context.services.forms.submit(parsed, context.actor);
    const queued = await context.client.rpc("app_get_intake_follow_up", { p_submission_id: submission.id });
    const followUp = !queued.error && queued.data === "not_required" ? "not_required"
      : await runIntakeSubmissionJob(submission.id).catch(() => "queued");
    let orderStart: { id: string; status: string; started: boolean; requested: boolean } | undefined;
    if (parsed.context.assignment_id) {
      try {
        const check = await context.client.rpc("app_reconcile_my_order_start", { p_assignment_id: parsed.context.assignment_id });
        const state = !check.error ? clientOrderStartSchema.nullable().parse(check.data) : null;
        if (state) orderStart = { id: state.order_id, status: state.status, started: state.started, requested: state.requested };
      } catch { /* The form is already saved; maintenance retries a pending start. */ }
    }
    revalidatePath("/account/onboarding");
    revalidatePath("/account/projects"); revalidatePath("/orders"); revalidatePath("/dashboard");
    const projectId = submission.order_id ?? orderStart?.id;
    if (projectId) revalidatePath(`/account/projects/${projectId}`);
    revalidatePath("/account");
    result = { id: submission.id, followUp, ...(orderStart ? { orderStart } : {}) };
    if (downloadReceipt === true && parsed.context.assignment_id) receiptPath = `/account/onboarding/${parsed.context.assignment_id}?submitted=${submission.id}`;
  } catch (error) {
    return failure(error);
  }
  // Revalidation can replace the form before its client-side download starts.
  if (receiptPath) redirect(receiptPath);
  return { ok: true, data: result };
}

export async function loadFormCollectionAvailability(canonicalKey?: string, expectedVersionId?: string, assignmentId?: string): Promise<boolean> {
  try {
    if (assignmentId && expectedVersionId) {
      const context = await getClientContext();
      const check = await context.client.rpc("app_my_intake_version_available", { p_assignment_id: assignmentId, p_version_id: expectedVersionId });
      return !check.error && check.data === true;
    }
    if (canonicalKey) {
      const repository = new FormRepository(await createNextServerSupabaseClient());
      const schema = await repository.getPublishedSchema(canonicalKey);
      return !expectedVersionId || schema.form_version_id === expectedVersionId;
    }
    const repository = new FormRepository(await createNextServerSupabaseClient());
    return await repository.workEnabled();
  } catch {
    return false;
  }
}

/**
 * The one anonymous mutation surface in the product.
 *
 * `app_submit_form` is the only RPC holding an `anon` EXECUTE grant, and it is
 * bounded by the Batch B2 identity → per-Form → global ceilings. Security C2-4
 * makes those ceilings OBSERVABLE: a public Form being hammered previously
 * produced a generic client message and no server record at all.
 *
 * The submitted answers are never logged. `form_version_id` is a validated UUID
 * and is what makes "which Form is being hit" answerable; the values array —
 * which is arbitrary respondent-authored text — is not passed to the logger on
 * any branch.
 */
export async function submitPublicFormAction(input: SubmitFormInput): Promise<FormMutationResult<{ id: string }>> {
  try {
    const parsed = parseInput(submitFormSchema, input);
    await requirePublicFormHuman();
    const repository = new FormRepository(await createNextServerSupabaseClient());
    const submission = await repository.submit(parsed);
    return { ok: true, data: { id: submission.id } };
  } catch (error) {
    const safe = await observeActionFailure(error, {
      action: "form.submit_public",
      actorClass: "anonymous",
      resourceType: "form_version",
      /*
       * Read defensively: a schema rejection throws before `parsed` exists, and
       * an unvalidated value must never reach the record. The builder drops
       * anything that is not a UUID regardless.
       */
      resourceId: typeof input?.form_version_id === "string" ? input.form_version_id : null,
    });
    return { ok: false, error: safe.message };
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
