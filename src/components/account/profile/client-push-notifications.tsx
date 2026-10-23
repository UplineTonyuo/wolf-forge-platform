"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { clientPushStatusAction, setClientPushAction } from "../../../app/actions/push";
import type { ClientPushConfiguration } from "../../../domain/notifications/push";

function applicationServerKey(key: string): ArrayBuffer {
  const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0)).buffer;
}

const subscribeSupport = () => () => {};
const serverSupport = () => null;
function browserSupport() {
  const homeScreenRequired = (/iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))
    && !window.matchMedia("(display-mode: standalone)").matches;
  return !homeScreenRequired && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function ClientPushNotifications({ config }: { config: ClientPushConfiguration }) {
  const headingId = useId();
  const supported = useSyncExternalStore(subscribeSupport, browserSupport, serverSupport);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let current = true;
    if (supported) {
      void navigator.serviceWorker.getRegistration("/").then(async (registration) => {
        const subscription = await registration?.pushManager.getSubscription();
        const enabled = subscription ? await clientPushStatusAction(subscription.endpoint) : false;
        if (current) setActive(enabled);
      }).catch(() => { if (current) setMessage("Notification settings could not be checked. Try again."); });
    }
    return () => { current = false; };
  }, [supported]);

  async function enable() {
    setBusy(true);
    setMessage("");
    let subscription: PushSubscription | null = null;
    let created = false;
    try {
      if (Notification.permission === "denied") {
        setMessage("Notifications are blocked. Allow them in your browser’s site settings, then try again.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Notifications were not enabled. You can keep using the notification bell.");
        return;
      }
      await navigator.serviceWorker.register("/push-sw.js", { scope: "/", updateViaCache: "none" });
      const registration = await navigator.serviceWorker.ready;
      subscription = await registration.pushManager.getSubscription();
      if (subscription && !(await clientPushStatusAction(subscription.endpoint))) {
        await subscription.unsubscribe();
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey),
        });
        created = true;
      }
      const result = await setClientPushAction(subscription.endpoint, true);
      if (!result.ok) throw new Error("Registration refused");
      setActive(true);
      setMessage("Notifications are enabled on this device.");
    } catch {
      if (created) await subscription?.unsubscribe().catch(() => false);
      setMessage("Notifications could not be enabled. Please try again.");
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true);
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const result = await setClientPushAction(subscription.endpoint, false);
        if (!result.ok) throw new Error("Disable refused");
        await subscription.unsubscribe();
      }
      for (const notification of await registration?.getNotifications() ?? []) notification.close();
      setActive(false);
      setMessage("Notifications are turned off on this device.");
    } catch { setMessage("Notifications could not be turned off. Please try again."); }
    finally { setBusy(false); }
  }

  return <section className="portal-section" aria-labelledby={headingId}>
    <header className="portal-section-head"><h2 id={headingId}>Device notifications</h2></header>
    <div className="portal-card portal-push-card">
      <p>Get notified about new workspace activity when this app is closed. Alerts show a general update; message text and client details stay inside your workspace.</p>
      {supported === false ? <p>This browser does not support push notifications here. On iPhone or iPad, add Wolf Forge to your Home Screen, then open it there.</p> : <div className="portal-form-actions">
        <button type="button" className="portal-primary-action" disabled={busy || supported === null} aria-busy={busy || undefined} onClick={active ? disable : enable}>
          {busy ? <Loader2 className="spinner" aria-hidden="true" /> : active ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
          {active ? "Turn off on this device" : "Enable on this device"}
        </button>
        <span>{active ? "Enabled" : "Not enabled"}</span>
      </div>}
      <p>Your device needs an internet connection and notifications allowed in its browser and system settings. Signing out stops new alerts for this session.</p>
      {message ? <p role="status">{message}</p> : null}
    </div>
  </section>;
}
