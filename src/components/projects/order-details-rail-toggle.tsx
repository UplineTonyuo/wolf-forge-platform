"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./project-detail.module.css";

/**
 * Native <details>/<summary>: the browser toggles it on click/tap/keyboard by
 * itself, so it can never go dead waiting on React to hydrate (the bug in the
 * previous useState + onClick version — a real tap that landed before
 * hydration attached the listener did nothing).
 *
 * Desktop's "always visible" contract is enforced purely in CSS
 * (`.railDetailsContent { display: block }` at desktop widths, which beats
 * the <details> UA default regardless of the `open` attribute or whether JS
 * has run at all) — never by JS state, so it can't flash collapsed. The
 * effect below only forces the native `open` attribute and `aria-expanded`
 * to match at desktop for correct screen-reader semantics; it has no bearing
 * on what's actually visible.
 */
export function RailDetailsToggle({ children }: { children: ReactNode }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const details = detailsRef.current;
    const summary = summaryRef.current;
    if (!details || !summary) return;

    const syncExpanded = () => summary.setAttribute("aria-expanded", String(details.open));
    const desktop = window.matchMedia("(min-width: 901px)");
    const syncDesktop = () => {
      if (desktop.matches) details.open = true;
      syncExpanded();
    };

    syncDesktop();
    details.addEventListener("toggle", syncExpanded);
    desktop.addEventListener("change", syncDesktop);
    return () => {
      details.removeEventListener("toggle", syncExpanded);
      desktop.removeEventListener("change", syncDesktop);
    };
  }, []);

  return (
    <details ref={detailsRef} className={styles.railDetails}>
      <summary ref={summaryRef} className={styles.railToggle} aria-expanded={false}>
        <span>Details</span>
        <ChevronDown aria-hidden="true" className={styles.railToggleIcon} />
      </summary>
      <div className={styles.railDetailsContent}>{children}</div>
    </details>
  );
}
