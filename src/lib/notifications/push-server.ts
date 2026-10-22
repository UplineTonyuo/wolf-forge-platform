import "server-only";

import { headers } from "next/headers";
import { clientPushAvailable, type ClientPushConfiguration } from "../../domain/notifications/push";
import { getClientContext } from "../supabase/next-server";

type PushRpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

export async function clientPushContext() {
  if (!clientPushAvailable(process.env)) return null;
  const context = await getClientContext();
  const rpc = context.client.rpc.bind(context.client) as unknown as PushRpc;
  const result = await rpc("app_get_my_push_configuration");
  if (result.error || !result.data) return null;
  const config = result.data as ClientPushConfiguration;
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() ?? requestHeaders.get("host");
  if (new URL(config.origin).host !== host) return null;
  return { rpc, config };
}
