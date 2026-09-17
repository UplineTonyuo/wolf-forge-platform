"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * The client portal's mobile navigation drawer.
 *
 * The toggle and the drawer itself are rendered by different components — the
 * toggle sits in the single header row (ClientCommandBar) and the drawer is the
 * sidebar's rail — so the open flag lives here rather than in either of them.
 * Same shape as the header-panel manager next door, and for the same reason:
 * one piece of header state, one owner.
 *
 * Above 900px the rail is permanent and the toggle is not rendered at all, so
 * this value is simply unused there.
 */
type PortalDrawerValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  close: () => void;
};

const PortalDrawerContext = createContext<PortalDrawerValue | null>(null);

export function PortalDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((current) => !current), []);
  const close = useCallback(() => setOpen(false), []);

  const value = useMemo<PortalDrawerValue>(
    () => ({ open, setOpen, toggle, close }),
    [close, open, toggle],
  );

  return <PortalDrawerContext.Provider value={value}>{children}</PortalDrawerContext.Provider>;
}

/**
 * Null outside the provider rather than throwing, matching `useHeaderPanels`:
 * the shell always supplies it, but a component rendered in isolation in a test
 * should degrade to "no drawer" instead of crashing.
 */
export function usePortalDrawer(): PortalDrawerValue | null {
  return useContext(PortalDrawerContext);
}
