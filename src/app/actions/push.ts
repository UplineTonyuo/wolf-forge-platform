"use server";

import { pushEndpointSchema } from "../../domain/notifications/push";
import { clientPushContext } from "../../lib/notifications/push-server";

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
