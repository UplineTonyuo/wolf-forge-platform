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
    const update = () => void setClientConversationPresenceAction(
      conversationType,
      conversationId,
      document.visibilityState === "visible",
    );
    update();
    const heartbeat = window.setInterval(update, 15_000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      void setClientConversationPresenceAction(conversationType, conversationId, false);
    };
  }, [conversationId, conversationType, active]);
}
