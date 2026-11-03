type Delivery = { id: string; attemptId: string; endpoint: string; ttl?: number };
type Settings = { origin: string; projectUrl: string; publicKey: string; privateKey: string };
type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
type RequestDetails = (subscription: { endpoint: string }, payload: null, options: {
  TTL: number; urgency: string; vapidDetails: { subject: string; publicKey: string; privateKey: string };
}) => { headers: Record<string, string> };

// Check again at the network boundary; a database value never authorizes an arbitrary fetch.
export function validPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return value.length <= 2048 && url.protocol === "https:" && !url.username && !url.password && !url.port
      && !url.hash && url.pathname.length > 1 && (["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(url.hostname)
        || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname));
  } catch { return false; }
}

async function dispatchPush(rpc: Rpc, details: RequestDetails, send: typeof fetch, projectUrl: string, calls = false) {
  const production = projectUrl === "https://jwynqsyirgenqlmkooah.supabase.co";
  if (!production && projectUrl !== "https://rsnmlcyopnxucwgfttyf.supabase.co") return { accepted: 0, refused: true };
  const settingsResult = await rpc("app_get_studio_push_dispatch_settings");
  if (settingsResult.error) throw new Error("Push configuration unavailable");
  if (!settingsResult.data) return { accepted: 0, refused: false };
  const settings = settingsResult.data as Settings;
  const originAllowed = production
    ? settings.origin === "https://wolf-forge-platform-woad.vercel.app"
    : /^https:\/\/wolf-forge-platform-[a-z0-9]+-wolf-forge\.vercel\.app$/.test(settings.origin);
  if (settings.projectUrl !== projectUrl || !originAllowed) return { accepted: 0, refused: true };
  const result = await rpc(calls ? "app_claim_ticket_call_push_deliveries" : "app_claim_studio_push_deliveries");
  if (result.error || !Array.isArray(result.data) || result.data.length > 10) throw new Error("Push queue unavailable");
  let accepted = 0;
  await Promise.all((result.data as Delivery[]).map(async (delivery) => {
    let outcome: "accepted" | "rejected" | "unknown" = "unknown";
    let status: number | null = null;
    if (!validPushEndpoint(delivery.endpoint) || (calls && (!Number.isInteger(delivery.ttl) || delivery.ttl! < 1 || delivery.ttl! > 40))) outcome = "rejected";
    else {
      try {
        const request = details({ endpoint: delivery.endpoint }, null, {
          TTL: calls ? delivery.ttl! : 300, urgency: calls ? "high" : "normal",
          vapidDetails: { subject: "https://github.com/UplineTonyuo/wolf-forge-platform", publicKey: settings.publicKey, privateKey: settings.privateKey },
        });
        const response = await send(delivery.endpoint, {
          method: "POST", headers: request.headers, body: null,
          redirect: "error", signal: AbortSignal.timeout(10000),
        });
        status = response.status;
        outcome = response.ok ? "accepted" : response.status >= 400 && response.status < 500 ? "rejected" : "unknown";
      } catch {
        // The provider may have accepted an interrupted request. Never blindly resend it.
      }
    }
    const finish = await rpc(calls ? "app_finish_ticket_call_push_delivery" : "app_finish_studio_push_delivery", {
      p_delivery_id: delivery.id, p_attempt_id: delivery.attemptId,
      p_outcome: outcome, p_http_status: status,
    });
    if (finish.error || finish.data !== true) throw new Error("Push receipt unavailable");
    if (outcome === "accepted") accepted++;
  }));
  return { accepted, refused: false };
}
export const dispatchClientPush = (rpc: Rpc, details: RequestDetails, send: typeof fetch, projectUrl: string) => dispatchPush(rpc, details, send, projectUrl);
export const dispatchCallPush = (rpc: Rpc, details: RequestDetails, send: typeof fetch, projectUrl: string) => dispatchPush(rpc, details, send, projectUrl, true);
