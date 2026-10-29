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

export const PRIVATE_DOWNLOAD_BUDGET_WINDOW_SECONDS = 24 * 60 * 60;

/**
 * Shared intake/Ticket/Project allowance: 500 MB/account and 10 GB/Tenant
 * (decimal bytes) over the trailing 24 hours. Constants live in the database's
 * app_consume_private_download_byte_budget function; tune them by migration.
 * Reserve authorized metadata size before Storage, including retries and reads
 * that subsequently fail. No refund: a failed response may still incur transfer.
 */
export async function enforcePrivateDownloadByteBudget(input: {
  actorId: string;
  tenantId: string;
  sizeBytes: number;
}): Promise<void> {
  const trusted = createTrustedServerSupabaseClient(readServerEnvironment());
  const { error } = await (trusted.rpc as unknown as (
    name: "app_consume_private_download_byte_budget",
    args: { p_actor_id: string; p_tenant_id: string; p_bytes: number },
  ) => Promise<{ error: unknown }>)("app_consume_private_download_byte_budget", {
    p_actor_id: input.actorId,
    p_tenant_id: input.tenantId,
    p_bytes: input.sizeBytes,
  });
  if (error) throw mapDatabaseError(error, "Request");
}
