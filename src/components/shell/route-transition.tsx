"use client";

import { useRouter } from "next/navigation";
import { createContext, startTransition, useContext, type MouseEvent, type ReactNode } from "react";

/*
 * Nested loading boundaries cannot paint before their prefetch arrives, and
 * router.push never prefetches. Share the shell's optimistic route with in-page
 * links and buttons so both gaps show the destination immediately. Keep the
 * update inside the navigation transition so commit or cancellation clears it.
 */
const RouteTransitionContext = createContext<((url: URL) => void) | null>(null);

export function RouteTransitionProvider({ begin, children }: { begin: (url: URL) => void; children: ReactNode }) {
  return <RouteTransitionContext.Provider value={begin}>{children}</RouteTransitionContext.Provider>;
}

export function navigationUrlForClick(event: MouseEvent<HTMLElement>): URL | null {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null;
  const anchor = target?.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self") || target?.closest('[data-route-skeleton="off"]')) return null;
  return new URL(anchor.href, window.location.href);
}

function persistentFrame(pathname: string): string | null {
  if (/^\/settings(?:\/|$)/.test(pathname)) return "/settings";
  const order = pathname.match(/^\/orders\/([^/]+)(?:\/|$)/)?.[1];
  return order && order !== "new" ? `/orders/${order}` : null;
}

export function coveredRoute(url: URL, pathname: string, inShell: (path: string) => boolean): string | null {
  if (url.origin !== window.location.origin || url.pathname === pathname || !inShell(url.pathname)) return null;
  const frame = persistentFrame(pathname);
  return frame && frame === persistentFrame(url.pathname) ? null : url.pathname;
}

export function useRouteTransitionPush() {
  const router = useRouter();
  const begin = useContext(RouteTransitionContext);
  if (!begin) return router.push;
  return (href: string, options?: Parameters<typeof router.push>[1]) => {
    startTransition(() => {
      begin(new URL(href, window.location.href));
      router.push(href, options);
    });
  };
}
