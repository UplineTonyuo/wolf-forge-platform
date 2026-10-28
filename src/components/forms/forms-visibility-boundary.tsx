"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { loadFormsVisibility } from "../../app/actions/forms-visibility";
import { formsAccessChanged } from "../../domain/forms/visibility";
import { ACCESS_REFRESH_INTERVAL_MS } from "../../domain/background-polling";

export function FormsVisibilityBoundary({ scope, signature, children }: {
  scope: "internal" | "client";
  signature: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [blocked, setBlocked] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let checking = false;
    async function check() {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const result = await loadFormsVisibility(scope);
        if (!disposed && ((!result.ok && result.denied) || (result.ok && result.signature !== signature))) {
          if (!result.ok || formsAccessChanged(signature, result.signature)) setBlocked(signature);
          router.refresh();
        }
      } catch {
        // A transport failure is not an authorization decision.
      } finally { checking = false; }
    }
    void check();
    const timer = window.setInterval(() => { void check(); }, ACCESS_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [scope, signature, router]);
  if (blocked === signature) return <p role="status">Form access has changed. Updating current information.</p>;
  return children;
}
