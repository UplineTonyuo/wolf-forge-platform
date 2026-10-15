"use server";

import { unstable_rethrow } from "next/navigation";
import type { SavedWhiteLabelDraft, WhiteLabelDraft, WhiteLabelDraftSummary } from "../../domain/white-label/draft";
import { PermissionDeniedError, type ClientSafeError, toClientSafeError } from "../../lib/errors/application-error";
import { isLocalQuickAccessSession } from "../../lib/qa/local-ui-bypass";
import { getInternalContext } from "../../lib/supabase/next-server";

/**
 * White Label draft actions (WL-2.33). Same boundary as the page, re-checked
 * on every call so an open builder loses access the moment it should:
 *   1. a real session, never the passwordless Quick Access identity;
 *   2. the global Platform Admin entitlement and Settings access;
 *   3. the RPC itself re-checks the entitlement from auth.uid() and the Tenant.
 * A Tenant id names the target only. Saving a draft publishes nothing.
 */

export type WhiteLabelActionResult<T> = { ok: true; data: T } | { ok: false; error: ClientSafeError };

async function platformAdminServices() {
  const context = await getInternalContext();
  if (await isLocalQuickAccessSession(context.actor)) throw new PermissionDeniedError();
  if (!(await context.services.permissions.isPlatformAdmin())) throw new PermissionDeniedError();
  await context.services.permissions.requireModuleAccess("settings");
  return context.services;
}

function failed<T>(error: unknown): WhiteLabelActionResult<T> {
  unstable_rethrow(error);
  return { ok: false, error: toClientSafeError(error) };
}

export async function getWhiteLabelDraftAction(tenantId: unknown): Promise<WhiteLabelActionResult<WhiteLabelDraft>> {
  try {
    return { ok: true, data: await (await platformAdminServices()).whiteLabel.getDraft(tenantId) };
  } catch (error) {
    return failed(error);
  }
}

export async function listWhiteLabelDraftsAction(): Promise<WhiteLabelActionResult<WhiteLabelDraftSummary[]>> {
  try {
    return { ok: true, data: await (await platformAdminServices()).whiteLabel.listDrafts() };
  } catch (error) {
    return failed(error);
  }
}

export async function saveWhiteLabelDraftAction(input: unknown): Promise<WhiteLabelActionResult<SavedWhiteLabelDraft>> {
  try {
    return { ok: true, data: await (await platformAdminServices()).whiteLabel.saveDraft(input) };
  } catch (error) {
    return failed(error);
  }
}
