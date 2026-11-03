"use server";

import { pushEndpointSchema } from "../../domain/notifications/push";
import { clientPushContext } from "../../lib/notifications/push-server";
import { callPushContext } from "../../lib/notifications/call-push-server";

/** No owner identity is returned. Only a verified foreign endpoint may be rotated. */
export async function browserPushEndpointStateAction(endpoint: string): Promise<"owned" | "foreign" | "unregistered" | null> {
  if (!pushEndpointSchema.safeParse(endpoint).success) return null;
  try {
    const context = await clientPushContext().catch(() => null) ?? await callPushContext();
    if (!context) return null;
    const result = await context.rpc("app_browser_push_endpoint_state", { p_endpoint: endpoint, p_origin: context.config.origin });
    return !result.error && (result.data === "owned" || result.data === "foreign" || result.data === "unregistered") ? result.data : null;
  } catch { return null; }
}

export async function setClientPushAction(endpoint: string, enabled: boolean) {
  const parsed = pushEndpointSchema.safeParse(endpoint);
  if (!parsed.success || typeof enabled !== "boolean") return { ok: false as const };
  try {
    const context = await clientPushContext();
    if (!context) return { ok: false as const };
    const result = await context.rpc("app_set_my_push_subscription", {
      p_endpoint: parsed.data, p_origin: context.config.origin, p_enabled: enabled,
    });
    return { ok: !result.error };
  } catch { return { ok: false as const }; }
}

export async function clientPushStatusAction(endpoint: string) {
  if (!pushEndpointSchema.safeParse(endpoint).success) return false;
  try {
    const context = await clientPushContext();
    if (!context) return false;
    const result = await context.rpc("app_my_push_subscription_active", { p_endpoint: endpoint });
    return !result.error && result.data === true;
  } catch { return false; }
}
