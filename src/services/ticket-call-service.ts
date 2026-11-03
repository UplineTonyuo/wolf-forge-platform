import "server-only";
import { z } from "zod";
import { callAvailability, callHistoryEntry, callMutation, callRead, callOwnerSummary, ticketCall } from "../domain/tickets/calls";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type { UserScopedClient } from "../lib/supabase/user-client";

export type CallRpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

export async function callRpc(client: CallRpc, name: string, args: Record<string, unknown>) {
  const result = await client.rpc(name, args);
  if (result.error) throw mapDatabaseError(result.error, "Call");
  return result.data;
}

export async function mutateTicketCall(client: UserScopedClient, value: unknown) {
  const input = callMutation.parse(value);
  const rpc = client as unknown as CallRpc;
  if (input.action === "request") {
    return ticketCall.parse(await callRpc(rpc, "app_request_ticket_call", {
      p_ticket_id: input.ticket_id, p_request_id: input.request_id, p_device_id: input.device_id, p_mode: input.mode,
      p_recipient_id: input.recipient_id ?? null,
    }));
  }
  if (input.action === "settings") {
    return z.boolean().parse(await callRpc(rpc, "app_configure_ticket_call_settings", {
      p_enabled: input.enabled, p_fallback_profile_id: input.fallback_profile_id, p_monthly_minutes: input.monthly_minutes,
    }));
  }
  const result = await callRpc(rpc, "app_ticket_call_command", {
    p_action: input.action, p_call_id: input.call_id, p_device_id: input.device_id,
  });
  return input.action === "end" || input.action === "cancel"
    ? z.object({ ended: z.literal(true) }).strict().parse(result) : ticketCall.parse(result);
}

export async function readTicketCalls(client: UserScopedClient, value: unknown) {
  const input = callRead.parse(value);
  const rpc = client as unknown as CallRpc;
  if (input.action === "current") {
    return callAvailability.parse(await callRpc(rpc, "app_ticket_call_current", { p_ticket_id: input.ticket_id, p_call_id: input.call_id }));
  }
  if (input.action === "prepare") {
    return callAvailability.parse(await callRpc(rpc,"app_ticket_call_prepare",{p_ticket_id:input.ticket_id}));
  }
  return input.action === "history"
    ? z.array(callHistoryEntry).max(50).parse(await callRpc(rpc, "app_ticket_call_history", {
      p_ticket_id: input.ticket_id, p_before: input.before, p_before_id: input.before_id,
    }))
    : callOwnerSummary.parse(await callRpc(rpc, "app_ticket_call_owner_summary", { p_month: input.month }));
}

export async function endTicketCall(client: UserScopedClient, _ticketId: string, callId: string) {
  return mutateTicketCall(client, { action: "end", call_id: callId });
}

// The obsolete UI cannot provision rooms while incoming-call UI is deferred.
export async function joinTicketCall(): Promise<never> {
  throw new Error("Media integration remains disabled in Phase 1");
}
