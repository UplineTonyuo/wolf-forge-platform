"use server";

import { toClientSafeError } from "../../lib/errors/application-error";
import { currentCorrelationId } from "../../lib/security/request-correlation";
import { getInternalContext } from "../../lib/supabase/next-server";
import type {
  SupervisedConversationPage,
  SupervisedMessageSearchPage,
  SupervisedMessageWindow,
  SupervisedTranscriptPage,
} from "../../domain/team-supervision/projections";

/**
 * Team supervision server actions. Read-only; exactly one service call each.
 *
 * `getInternalContext()` builds the service on this request's user-scoped
 * client, and the RPC behind it re-derives the supervisor from auth.uid() and
 * requires team_messages.supervise. Nothing here checks a role, and no
 * parameter names an actor, role or permission.
 *
 * The audit correlation id is never caller input: content reads overwrite any
 * `correlationId` key with the proxy-stamped request id (or undefined when
 * absent). The list writes no audit, so it forwards none.
 *
 * Nothing is cached, revalidated or logged. The search query goes to the
 * service and nowhere else.
 */

export type TeamSupervisionActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function failed<T>(error: unknown): TeamSupervisionActionResult<T> {
  return { ok: false, error: toClientSafeError(error).message };
}

/** Replaces any caller-supplied correlation id with the trusted request one. */
async function withRequestCorrelation(input: unknown): Promise<unknown> {
  if (typeof input !== "object" || input === null) return input;
  return { ...input, correlationId: (await currentCorrelationId()) ?? undefined };
}

export async function listSupervisedConversationsAction(
  input: unknown = {},
): Promise<TeamSupervisionActionResult<SupervisedConversationPage>> {
  try {
    const context = await getInternalContext();
    return { ok: true, data: await context.services.teamSupervision.listConversations(input) };
  } catch (error) {
    return failed(error);
  }
}

export async function getSupervisedConversationAction(
  input: unknown,
): Promise<TeamSupervisionActionResult<SupervisedTranscriptPage>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.teamSupervision.getConversation(
        await withRequestCorrelation(input),
      ),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function listSupervisedMessagesBeforeAction(
  input: unknown,
): Promise<TeamSupervisionActionResult<SupervisedTranscriptPage>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.teamSupervision.listMessagesBefore(
        await withRequestCorrelation(input),
      ),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function getSupervisedMessageWindowAction(
  input: unknown,
): Promise<TeamSupervisionActionResult<SupervisedMessageWindow>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.teamSupervision.getMessageWindow(
        await withRequestCorrelation(input),
      ),
    };
  } catch (error) {
    return failed(error);
  }
}

export async function searchSupervisedConversationAction(
  input: unknown,
): Promise<TeamSupervisionActionResult<SupervisedMessageSearchPage>> {
  try {
    const context = await getInternalContext();
    return {
      ok: true,
      data: await context.services.teamSupervision.searchConversation(
        await withRequestCorrelation(input),
      ),
    };
  } catch (error) {
    return failed(error);
  }
}
