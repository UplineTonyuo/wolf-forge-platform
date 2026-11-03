import { browserPushEndpointStateAction } from "../../app/actions/push";

let enrollment: Promise<PushSubscription> | null = null;

/** Message and call settings share one browser endpoint and one in-flight enrollment. */
export async function ensureBrowserPushSubscription(publicKey: string): Promise<PushSubscription> {
  const attempt = enrollment ??= (async () => {
    const registration = await navigator.serviceWorker.getRegistration("/")
      ?? await navigator.serviceWorker.register("/push-sw.js", { scope: "/", updateViaCache: "none" });
    await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      const state = await browserPushEndpointStateAction(existing.endpoint);
      if (state === null) throw new Error("Subscription ownership could not be confirmed.");
      if (state !== "foreign") return existing;
      // Explicit settings gesture + authoritative foreign ownership; never rotate on a failed read.
      if (!await existing.unsubscribe()) throw new Error("Device notification reset failed.");
    }
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  })();
  try { return await attempt; }
  finally { if (enrollment === attempt) enrollment = null; }
}
