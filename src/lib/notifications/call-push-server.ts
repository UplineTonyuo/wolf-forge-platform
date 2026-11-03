import "server-only";
import { headers } from "next/headers";
import { z } from "zod";
import { clientPushAvailable } from "../../domain/notifications/push";
import { clientSupportRequested } from "../supabase/client-support";
import { getVerifiedSessionContext } from "../supabase/next-server";
import type { CallRpc } from "../../services/ticket-call-service";

const configuration = z.object({ origin: z.url(), publicKey: z.string().regex(/^[A-Za-z0-9_-]{87}$/) }).strict();
export async function callPushContext() {
  if (await clientSupportRequested() || !clientPushAvailable(process.env)) return null;
  const context = await getVerifiedSessionContext();
  if (!context || context.actor.support) return null;
  const rpc = context.client.rpc.bind(context.client) as unknown as CallRpc["rpc"];
  const result = await rpc("app_get_my_call_push_configuration", {});
  const config = configuration.safeParse(result.data);
  if (result.error || !config.success) return null;
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() ?? requestHeaders.get("host");
  const origin = new URL(config.data.origin);
  if (origin.protocol !== "https:" || origin.origin !== config.data.origin || origin.host !== host) return null;
  return { rpc, config: config.data };
}
