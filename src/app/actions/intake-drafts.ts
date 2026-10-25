"use server";

import { z } from "zod";
import { formSubmissionValueSchema } from "../../domain/forms/schema";
import { toClientSafeError } from "../../lib/errors/application-error";
import { mapDatabaseError } from "../../lib/errors/map-database-error";
import { getClientContext, getSelfServiceContext } from "../../lib/supabase/next-server";

export async function loadIntakeFollowUp(submissionId: string) {
  try {
    z.uuid().parse(submissionId);
    const context = await getSelfServiceContext();
    const result = await context.client.rpc("app_get_intake_follow_up", { p_submission_id: submissionId });
    if (result.error) throw mapDatabaseError(result.error, "Submission follow-up");
    return z.enum(["not_required", "queued", "completed", "blocked"]).parse(result.data);
  } catch { return null; }
}

export async function loadIntakeDraft(assignmentId: string) {
  try {
    z.uuid().parse(assignmentId);
    const context = await getClientContext();
    const result = await context.client.rpc("app_get_intake_draft", { p_assignment_id: assignmentId });
    if (result.error) throw mapDatabaseError(result.error, "Saved form");
    const draft = z.object({ values: z.array(formSubmissionValueSchema), updated_at: z.string(), expires_at: z.string() }).nullable().parse(result.data);
    return { ok: true as const, draft };
  } catch (error) { return { ok: false as const, error: toClientSafeError(error).message }; }
}

export async function saveIntakeDraft(assignmentId: string, values: unknown) {
  try {
    z.uuid().parse(assignmentId);
    const answers = z.array(formSubmissionValueSchema).max(300).parse(values);
    const context = await getClientContext();
    const result = await context.client.rpc("app_save_intake_draft", { p_assignment_id: assignmentId, p_values: answers });
    if (result.error) throw mapDatabaseError(result.error, "Saved form");
    return { ok: true as const };
  } catch (error) { return { ok: false as const, error: toClientSafeError(error).message }; }
}
