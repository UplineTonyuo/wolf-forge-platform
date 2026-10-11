"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { financialAuthority, financialRecordIds } from "../../domain/invoices/visibility";
import { loadFinancialVisibilityAction } from "../../app/actions/financial-visibility";

export function FinancialVisibilityBoundary({ scope, signature, invoiceId, children }: {
  scope: "internal" | "internal-work" | "client" | "client-detail" | "wallet" | "store" | "dashboard";
  signature: string;
  invoiceId?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [blocked, setBlocked] = useState<{ signature: string; state: "updating" | "denied" } | null>(null);
  const state = blocked?.signature === signature ? blocked.state : "visible";
  useEffect(() => {
    let canceled = false;
    let inFlight = false;
    const check = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const result = await loadFinancialVisibilityAction(scope, invoiceId);
        if (canceled) return;
        if (!result.ok && result.denied) {
          setBlocked((previous) => previous?.signature === signature && previous.state === "denied" ? previous : { signature, state: "denied" });
          router.refresh();
        } else if (result.ok && result.signature !== signature) {
          const nextIds = financialRecordIds(scope, result.signature);
          const protectedIds = invoiceId ? [invoiceId] : financialRecordIds(scope, signature);
          if (financialAuthority(scope, result.signature) !== financialAuthority(scope, signature) || protectedIds.some((id) => !nextIds.includes(id))) {
            setBlocked((previous) => previous?.signature === signature && previous.state === "updating" ? previous : { signature, state: "updating" });
          }
          router.refresh();
        }
      } catch {
        // A transport failure does not establish an authorization denial.
      } finally {
        inFlight = false;
      }
    };
    void check();
    const interval = window.setInterval(() => void check(), 15_000);
    const resume = () => void check();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      canceled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [scope, signature, invoiceId, router]);
  if (state === "denied") return <p role="alert">This financial information is no longer available.</p>;
  if (state === "updating") return <p role="status">Financial information is updating.</p>;
  return children;
}
