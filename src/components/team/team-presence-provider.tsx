"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { touchTeamPresenceAction } from "../../app/actions/team-messages";
import { randomUuid } from "../../lib/random-uuid";

const HEARTBEAT_INTERVAL_MS = 25_000;
const DISCONNECT_ENDPOINT = "/api/team-presence/disconnect";

export type TeamPresenceStatus = "online" | "offline" | "unknown";

type TeamPresenceValue = {
  statusFor: (profileId: string) => TeamPresenceStatus;
};

const unavailablePresence: TeamPresenceValue = {
  statusFor: () => "unknown",
};

const TeamPresenceContext = createContext<TeamPresenceValue>(unavailablePresence);

/**
 * One provider per internal shell, and one opaque connection id per mounted
 * browser tab. No profile id crosses this boundary: the heartbeat server
 * action derives the actor from the HttpOnly Supabase session, preserving the
 * app's no-browser-token posture.
 */
export function TeamPresenceProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<{
    ready: boolean;
    profileIds: string[];
  }>({ ready: false, profileIds: [] });
  const inFlightRef = useRef(false);
  const activeRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let alive = true;
    const connectionId = randomUuid();
    activeRef.current = true;

    const heartbeat = async () => {
      if (!alive || !activeRef.current || inFlightRef.current) return;

      inFlightRef.current = true;
      try {
        const result = await touchTeamPresenceAction(connectionId);
        if (alive && activeRef.current && result.ok) {
          setSnapshot({ ready: true, profileIds: result.data });
        }
      } catch {
        // Keep the last confirmed snapshot through a transient network failure.
      } finally {
        inFlightRef.current = false;
      }
    };

    const disconnect = () => {
      if (!activeRef.current) return;
      activeRef.current = false;

      const body = JSON.stringify({ connectionId });
      const payload = new Blob([body], { type: "application/json" });
      if (typeof navigator.sendBeacon === "function") {
        if (navigator.sendBeacon(DISCONNECT_ENDPOINT, payload)) return;
      }

      void fetch(DISCONNECT_ENDPOINT, {
        method: "POST",
        body,
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        keepalive: true,
      }).catch(() => undefined);
    };

    const resume = () => {
      activeRef.current = true;
      void heartbeat();
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void heartbeat();
    };

    const onPageHide = () => disconnect();
    const timer = window.setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);

    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    void heartbeat();

    return () => {
      alive = false;
      disconnect();
      window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [enabled]);

  const onlineProfileIds = useMemo(
    () => new Set(snapshot.profileIds),
    [snapshot.profileIds],
  );

  const statusFor = useCallback(
    (profileId: string): TeamPresenceStatus => {
      if (!snapshot.ready) return "unknown";
      return onlineProfileIds.has(profileId) ? "online" : "offline";
    },
    [onlineProfileIds, snapshot.ready],
  );

  const value = useMemo(() => ({ statusFor }), [statusFor]);

  return (
    <TeamPresenceContext.Provider value={value}>
      {children}
    </TeamPresenceContext.Provider>
  );
}

export function useTeamPresence() {
  return useContext(TeamPresenceContext);
}
