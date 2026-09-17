"use client";

import { useEffect } from "react";

const EVENT = "wf:header-overlay-open";

type HeaderOverlayDetail = { id: string };

/**
 * Keeps at most one workspace command bar surface open at a time —
 * Notifications, Team Messages, Quick Action, Account — on mobile where they
 * can visually stack instead of replacing each other. Each surface announces
 * its own id the moment it opens and is told to close whenever a different
 * id announces, instead of every surface tracking every other surface's
 * boolean directly.
 */
export function useHeaderOverlay(id: string, open: boolean, onForceClose: () => void) {
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent<HeaderOverlayDetail>(EVENT, { detail: { id } }));
  }, [open, id]);

  useEffect(() => {
    function onOverlayOpen(event: Event) {
      const detail = (event as CustomEvent<HeaderOverlayDetail>).detail;
      if (detail && detail.id !== id) onForceClose();
    }

    window.addEventListener(EVENT, onOverlayOpen);
    return () => window.removeEventListener(EVENT, onOverlayOpen);
  }, [id, onForceClose]);
}
