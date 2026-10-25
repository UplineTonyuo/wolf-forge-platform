"use client";

import { useEffect } from "react";
import { setClientConversationPresenceAction } from "../../app/actions/notifications";

export function useClientConversationPresence(
  conversationType: "ticket" | "project",
  conversationId: string,
  active = true,
) {
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let inFlight = false;
    let pending = false;
    let lastState: boolean | null = null;
    const send = async (visible: boolean) => {
      if (!navigator.onLine || (!alive && visible)) return;
      if (!visible && lastState !== true) return;
      if (inFlight) { pending = true; return; }
      inFlight = true;
      lastState = visible;
      try {
        await setClientConversationPresenceAction(conversationType, conversationId, visible);
      } catch {
        // Presence expires in the database when the connection cannot confirm it.
      } finally {
        inFlight = false;
        if (!alive) { void send(false); return; }
        if (pending) {
          pending = false;
          void send(document.visibilityState === "visible");
        }
      }
    };
    const update = () => void send(document.visibilityState === "visible");
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") void send(true);
    }, 15_000);
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("online", update);
    return () => {
      alive = false;
      pending = false;
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("online", update);
      void send(false);
    };
  }, [conversationId, conversationType, active]);
}
