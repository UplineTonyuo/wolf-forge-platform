"use server";

import { unstable_rethrow } from "next/navigation";
import type { PublicationPreflight, PublicationReconciliation, PublishWhiteLabelInput, PublishWhiteLabelResult } from "../../domain/white-label/publication";
import { PermissionDeniedError, toClientSafeError } from "../../lib/errors/application-error";
import { isLocalQuickAccessSession } from "../../lib/qa/local-ui-bypass";
import { getInternalContext } from "../../lib/supabase/next-server";
import { WhiteLabelPublicationRepository } from "../../repositories/white-label-publication-repository";
import { WhiteLabelPublicationService } from "../../services/white-label-publication-service";
import type { WhiteLabelActionResult } from "./white-label";

async function publicationService(actorScopeId: string) {
  const context = await getInternalContext();
  if (await isLocalQuickAccessSession(context.actor)) throw new PermissionDeniedError();
  if (!(await context.services.permissions.isPlatformAdmin())) throw new PermissionDeniedError();
  await context.services.permissions.requireModuleAccess("settings");
  // A retained page cannot submit another actor's recovery intent after a session change.
  if (context.actor.id !== actorScopeId) throw new PermissionDeniedError();
  return new WhiteLabelPublicationService({ repository: new WhiteLabelPublicationRepository(context.client) });
}

function failed<T>(error: unknown): WhiteLabelActionResult<T> {
  unstable_rethrow(error);
  return { ok: false, error: toClientSafeError(error) };
}

export async function preflightWhiteLabelPublicationAction(actorScopeId: string, input: Pick<PublishWhiteLabelInput, "tenantId" | "sourceDraftRevision" | "expectedPublicationRevision">): Promise<WhiteLabelActionResult<PublicationPreflight>> {
  try { return { ok: true, data: await (await publicationService(actorScopeId)).preflight(input) }; }
  catch (error) { return failed(error); }
}

export async function publishWhiteLabelDraftAction(actorScopeId: string, input: PublishWhiteLabelInput): Promise<WhiteLabelActionResult<PublishWhiteLabelResult>> {
  try { return { ok: true, data: await (await publicationService(actorScopeId)).publish(input) }; }
  catch (error) { return failed(error); }
}

export async function reconcileWhiteLabelPublicationAction(actorScopeId: string, input: PublishWhiteLabelInput): Promise<WhiteLabelActionResult<PublicationReconciliation>> {
  try { return { ok: true, data: await (await publicationService(actorScopeId)).reconcile(input) }; }
  catch (error) { return failed(error); }
}
