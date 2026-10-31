import "server-only";

import { readServerEnvironment } from "../env/server-env";
import { mapDatabaseError } from "../errors/map-database-error";
import { createTrustedServerSupabaseClient } from "../supabase/trusted-server-client";

export type ServerCostAction =
  | "search.global"
  | "search.client"
  | "report.send"
  | "integration.gmail.verify"
  | "account.provision"
  | "billing.stripe_customer"
  | "intake.file_upload"
  | "intake.file_download"
  | "invoice.receipt_upload"
  | "invoice.receipt_download"
  | "ticket.file_download"
  | "team.voice.finalize";

/**
 * Durable, multi-instance preflight for authenticated application work that
 * fans out or reaches a paid provider. Actor and organization ids must come
 * from a verified server context, never directly from browser authority.
 */
export async function enforceServerCostLimit(input: {
  actorId: string;
  action: ServerCostAction;
  organizationId?: string | null;
}): Promise<void> {
  const trusted = createTrustedServerSupabaseClient(readServerEnvironment());
  const { error } = await trusted.rpc("app_consume_server_cost_limit", {
    p_actor_id: input.actorId,
    p_action: input.action,
    ...(input.organizationId ? { p_organization_id: input.organizationId } : {}),
  });
  if (error) throw mapDatabaseError(error, "Request");
}
