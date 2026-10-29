"use client";

import { useEffect, useState, type ReactNode } from "react";
import { loadCouponAccessAction } from "../../app/actions/coupons";
import { ACCESS_REFRESH_INTERVAL_MS } from "../../domain/polling-constants";

export function CouponAccessBoundary({ children }: { children: ReactNode }) {
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let canceled = false;
    let inFlight = false;
    const check = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const result = await loadCouponAccessAction();
        if (!canceled && (result.ok ? !result.allowed : result.denied)) setUnavailable(true);
      } catch {
        // Transport failure does not prove that access was revoked.
      } finally {
        inFlight = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), ACCESS_REFRESH_INTERVAL_MS);
    const resume = () => void check();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      canceled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  return unavailable ? <p role="alert">Coupons are no longer available. Existing financial discounts are preserved.</p> : children;
}
