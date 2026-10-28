"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { loadSubscriptionVisibilityAction } from "../../app/actions/subscriptions";
import { ACCESS_REFRESH_INTERVAL_MS } from "../../domain/background-polling";

export function SubscriptionHistoryBoundary({ ids, audience, states = [], workEnabled, onRefresh, children }: {
  ids: string[];
  states?: string[];
  workEnabled?: boolean;
  onRefresh?: () => void;
  audience: "internal" | "client";
  children: ReactNode;
}) {
  const [unavailable, setUnavailable] = useState(false);
  const [updating, setUpdating] = useState(false);
  const router = useRouter();
  const expectedIds = ids.join(",");
  const expectedStates = states.join(",");
  useEffect(() => {
    let canceled = false;
    let inFlight = false;
    const check = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const result = await loadSubscriptionVisibilityAction(audience);
        if (canceled) return;
        const revoked = result.ok
          ? expectedIds.split(",").filter(Boolean).some((id) => !result.ids.includes(id))
          : result.denied;
        if (revoked) {
          setUnavailable(true);
          if (onRefresh) onRefresh(); else router.refresh();
        } else if (result.ok && (
          (workEnabled !== undefined && result.workEnabled !== workEnabled)
          || expectedStates.split(",").filter(Boolean).some((state) => !result.states.includes(state))
        )) {
          setUpdating(true);
          if (onRefresh) onRefresh(); else router.refresh();
        }
      } catch {
        // Transport failures do not establish an authorization denial.
      } finally {
        inFlight = false;
      }
    };
    void check();
    const interval = window.setInterval(() => void check(), ACCESS_REFRESH_INTERVAL_MS);
    const resume = () => void check();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      canceled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [audience, expectedIds, expectedStates, workEnabled, onRefresh, router]);
  if (updating && !unavailable) return <p role="status">Subscription history is updating.</p>;
  return unavailable ? <p role="alert">This Subscription history is no longer available.</p> : children;
}
