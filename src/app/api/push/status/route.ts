import { pushEndpointSchema } from "../../../../domain/notifications/push";
import { clientPushContext } from "../../../../lib/notifications/push-server";
import { readBoundedJson } from "../../../../lib/security/bounded-json";
import { requestIsSameOrigin } from "../../../../lib/security/same-origin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const reply = (active: boolean, status = 200) => Response.json({ active }, {
    status, headers: { "cache-control": "private, no-store" },
  });
  if (!requestIsSameOrigin(request)) return reply(false, 403);
  const body = await readBoundedJson(request, 3072);
  if (!body.ok) return reply(false, body.status);
  const endpoint = pushEndpointSchema.safeParse((body.value as { endpoint?: unknown } | null)?.endpoint);
  if (!endpoint.success) return reply(false, 400);
  try {
    const context = await clientPushContext();
    if (!context) return reply(false, 403);
    const result = await context.rpc("app_my_push_subscription_active", { p_endpoint: endpoint.data });
    return reply(!result.error && result.data === true);
  } catch { return reply(false, 401); }
}
