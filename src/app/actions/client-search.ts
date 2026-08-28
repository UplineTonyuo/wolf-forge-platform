"use server";

import {
  MIN_QUERY_LENGTH,
  rankResults,
  toMessageCandidate,
  toProjectCandidate,
  toServiceCandidate,
  type ClientSearchCandidate,
  type ClientSearchResponse,
} from "../../domain/client-portal/search";
import { toClientSafeError } from "../../lib/errors/application-error";
import { enforceServerCostLimit } from "../../lib/security/server-cost-limit";
import { getClientContext } from "../../lib/supabase/next-server";

/**
 * Client portal global search.
 *
 * Runs entirely on the server against the caller's own session. There is no
 * company id, account id or scope parameter in the signature — the only input
 * is the query text. Everything else is derived:
 *
 *   getClientContext()  resolves the account through app_get_client_account_context,
 *                       which reads auth.uid() and refuses anything else.
 *   module grants       decide which of the three sources are read at all; a
 *                       denied module is skipped rather than filtered later.
 *   RLS / RPCs          decide which rows come back. Projects go through
 *                       orders_client_select_own_company; conversations through
 *                       app_list_ticket_summaries; the catalog through the
 *                       services RLS policies.
 *
 * So client isolation here is exactly the isolation the rest of the portal
 * already has: this action cannot widen it, because it never names a company.
 *
 * Nothing is fetched into the browser to be searched. Rows are matched and
 * trimmed here, and only the client-safe projection crosses the wire.
 */

/** A read the account is not entitled to resolves to null and is skipped. */
async function whenGranted<T>(
  granted: boolean | undefined,
  read: () => Promise<T>,
): Promise<T | null> {
  if (granted !== true) return null;
  return read();
}

export async function clientSearchAction(rawQuery: string): Promise<ClientSearchResponse> {
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";

  if (query.length < MIN_QUERY_LENGTH) {
    return { ok: true, query, results: [] };
  }

  /* A pathological query is a client mistake, not a reason to scan. */
  if (query.length > 120) {
    return { ok: true, query, results: [] };
  }

  try {
    const context = await getClientContext();
    await enforceServerCostLimit({
      actorId: context.actor.id,
      action: "search.client",
      organizationId: context.user.companyId,
    });
    const { modules } = context.user;

    const [projects, tickets, catalog] = await Promise.all([
      whenGranted(modules.portal_projects, () => context.services.projects.listClientProjects()),
      whenGranted(modules.portal_tickets, () => context.services.tickets.list()),
      whenGranted(modules.portal_store, () => context.services.catalog.listStoreCatalog()),
    ]);

    const results = [
      /*
       * Each group is ranked and trimmed on its own, so a project with many
       * matches cannot crowd conversations or services out of the panel.
       */
      ...rankResults(
        query,
        (projects ?? []).map((project) =>
          toProjectCandidate({
            id: project.id,
            reference: project.reference,
            title: project.title,
            status: project.status,
            serviceName: project.serviceName,
          }),
        ),
      ),

      ...rankResults(
        query,
        (tickets ?? [])
          .filter((ticket) => !ticket.archived_at)
          /*
           * Only the client-safe fields are read here. Message bodies are never
           * loaded, so an internal note cannot reach the matching logic, the
           * result list or its metadata.
           */
          .map((ticket) =>
            toMessageCandidate({
              ticket_id: ticket.ticket_id,
              public_ref: ticket.public_ref,
              subject: ticket.subject,
              status: ticket.status,
            }),
          ),
      ),

      ...rankResults(
        query,
        (catalog?.folders ?? []).flatMap((folder) =>
          folder.services.map((service) =>
            toServiceCandidate({
              id: service.id,
              name: service.name,
              folderName: folder.name,
              priceLabel: service.priceLabel,
              recurringLabel: service.recurringLabel,
            }),
          ),
        ).concat(
          (catalog?.ungrouped ?? []).map((service) =>
            toServiceCandidate({
              id: service.id,
              name: service.name,
              folderName: null,
              priceLabel: service.priceLabel,
              recurringLabel: service.recurringLabel,
            }),
          ),
        ) satisfies ClientSearchCandidate[],
      ),
    ];

    return { ok: true, query, results };
  } catch (error) {
    /* Database and permission detail never reaches the browser. */
    const safe = toClientSafeError(error);
    return {
      ok: false,
      error: safe.code === "PERMISSION_DENIED" ? "Search is unavailable." : "Search failed.",
    };
  }
}
