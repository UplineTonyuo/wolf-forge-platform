/* Push only: no fetch handler, offline cache, transcript or session storage. */
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const subscription = await self.registration.pushManager.getSubscription();
    if (!subscription) return;
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
    const destination = new URL("/launch", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => {
      const url = new URL(client.url);
      return url.origin === self.location.origin && (url.pathname === "/account" || url.pathname.startsWith("/account/"));
    });
    if (existing) {
      // Focusing an open workspace must not discard its unsent work.
      await existing.focus();
    } else {
      await self.clients.openWindow(destination);
    }
  })());
});
