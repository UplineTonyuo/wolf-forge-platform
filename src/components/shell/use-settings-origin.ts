"use client";

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { routeIsCurrent } from "./nav-registry";

const fallback = "/dashboard";
const changed = "wf-settings-origin-changed";

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(changed, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(changed, listener);
  };
}

function savedOrigin(scope: string): string | null {
  const entry = window.history.state?.wfSettingsOrigin;
  if (entry?.scope !== scope || typeof entry.href !== "string") return null;
  const path: string = entry.href;
  if (!path.startsWith("/") || new URL(path, window.location.origin).origin !== window.location.origin) return null;
  return path;
}

export function useSettingsOrigin(pathname: string, scope: string) {
  const lastMain = useRef({ scope, href: fallback });
  const back = useSyncExternalStore(subscribe, () => {
    if (routeIsCurrent("/settings", pathname)) return savedOrigin(scope);
    // The shell can already show Settings while the main route is still committed.
    const captured = lastMain.current;
    return captured.scope === scope ? captured.href : null;
  }, () => null);

  function rememberMain() {
    if (window.location.pathname !== pathname || routeIsCurrent("/settings", pathname)) return;
    const href = pathname + window.location.search + window.location.hash;
    if (lastMain.current.scope === scope && lastMain.current.href === href) return;
    lastMain.current = { scope, href };
    window.dispatchEvent(new Event(changed));
  }

  useLayoutEffect(() => {
    if (window.location.pathname !== pathname) return;
    if (!routeIsCurrent("/settings", pathname)) {
      rememberMain();
      return;
    }
    // Each Settings history entry owns its return URL, including direct entries.
    // App Router writes the new history entry before layout effects run.
    const existing = savedOrigin(scope);
    if (existing !== null) {
      lastMain.current = { scope, href: existing };
    } else {
      const href = lastMain.current.scope === scope ? lastMain.current.href : fallback;
      window.history.replaceState({ ...window.history.state, wfSettingsOrigin: { scope, href } }, "");
      window.dispatchEvent(new Event(changed));
    }
  });

  return { back: back ?? fallback, rememberMain };
}
