/* Push only: no fetch handler, offline cache, transcript or session storage. */
const callUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function appWindow(client) {
  try {
    const url = new URL(client.url);
    return url.origin === self.location.origin && /^\/(account|dashboard|orders|tickets|reporting|clients|todo|invoices|subscriptions|coupons|investment-intent|services|forms|team|settings|calls)(\/|$)/.test(url.pathname);
  } catch { return false; }
}
async function incomingCall(endpoint) {
  try {
    const response = await fetch("/api/ticket-call-push", {
      method: "POST", credentials: "include", cache: "no-store", redirect: "error",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "status", endpoint }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const value = await response.json(); const call = value?.data?.call;
    return value.ok === true && value.data.active === true && call && callUuid.test(call.id) && Number.isSafeInteger(call.version) && call.version > 0 ? call : null;
  } catch { return null; }
}
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const subscription = await self.registration.pushManager.getSubscription();
    if (!subscription) return;
    const call = await incomingCall(subscription.endpoint);
    if (call) {
      const windows = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter(appWindow);
      for (const client of windows) client.postMessage({ type: "wolf-forge-call", id: call.id, version: call.version });
      // A visible notification honours userVisibleOnly; no private peer or conversation content.
      await self.registration.showNotification("Incoming call from Wolf Forge", {
        body: "Open Wolf Forge to answer.", icon: "/branding/app-192.png", badge: "/branding/app-192.png",
        tag: `wolf-forge-call-${call.id}`, renotify: false, data: { callId: call.id, version: call.version },
      });
      return;
    }
    try {
      const response = await fetch("/api/push/status", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok || (await response.json()).active !== true) return;
      await self.registration.showNotification("Wolf Forge", {
        body: "You have a new update. Open your workspace to view it.",
        icon: "/branding/app-192.png",
        badge: "/branding/app-192.png",
        tag: "wolf-forge-update",
      });
    } catch {
      // Fail closed when the current account or delivery cannot be verified.
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data;
    const call = data && callUuid.test(data.callId) && Number.isSafeInteger(data.version) && data.version > 0 ? data : null;
    const destination = new URL(call ? `/calls/${call.callId}` : "/launch", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => {
      if (call) return appWindow(client);
      const url = new URL(client.url);
      return url.origin === self.location.origin && (url.pathname === "/account" || url.pathname.startsWith("/account/"));
    });
    if (existing) {
      // Focusing an open workspace must not discard its unsent work.
      await existing.focus();
      if (call) existing.postMessage({ type: "wolf-forge-call", id: call.callId, version: call.version });
    } else {
      await self.clients.openWindow(destination);
    }
  })());
});
