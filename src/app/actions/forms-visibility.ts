"use server";

import { unstable_rethrow } from "next/navigation";
import { formsVisibility } from "../../domain/forms/visibility";
import { toClientSafeError } from "../../lib/errors/application-error";
import { getClientContext, getInternalContext } from "../../lib/supabase/next-server";

export async function loadFormsVisibility(scope: "internal" | "client") {
  try {
    const context = scope === "internal" ? await getInternalContext() : await getClientContext();
    const [enabled, forms, submissions, assignments] = await Promise.all([
      context.services.forms.workEnabled(),
      scope === "internal" ? context.services.forms.list() : Promise.resolve([]),
      context.services.forms.listSubmissions(),
      scope === "client" || ("forms" in context.user && (context.user.forms.assign || context.user.forms.submissionsView))
        ? context.services.forms.listAssignments() : Promise.resolve([]),
    ]);
    return { ok: true as const, signature: formsVisibility(context.user, enabled, [
      ...forms.map((row) => `form:${row.id}`),
      ...submissions.map((row) => `submission:${row.id}`),
      ...assignments.map((row) => `assignment:${row.assignment_id}`),
    ]) };
  } catch (error) {
    unstable_rethrow(error);
    const safe = toClientSafeError(error);
    return { ok: false as const, denied: safe.code === "PERMISSION_DENIED" || safe.code === "NOT_FOUND" };
  }
}
