"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * One floating panel at a time, for the whole client header.
 *
 * Every hover-openable header trigger — catalogue, notifications, quick actions —
 * goes through
 * this manager rather than owning its own open flag. That is what makes
 * overlapping impossible: `active` holds a single id, so opening one panel
 * closes whatever was open by construction rather than by each panel
 * remembering to dismiss the others.
 *
 * Interaction model, identical for every trigger:
 *
 *   hover in       opens that panel unpinned (fine pointers only)
 *   hover out      closes after a short grace period
 *   hover across   the next trigger cancels the pending close and takes over
 *   click          pins the panel; clicking the same trigger again closes it
 *   outside click  closes
 *   Escape         closes and returns focus to the trigger
 *
 * The grace period is what stops the row feeling twitchy: the pointer has to
 * cross a gap between a trigger and its panel, and an immediate close would
 * dismiss the panel mid-crossing.
 */

export type HeaderPanelId = "search" | "services" | "notifications" | "quick";

/** Long enough to cross the trigger/panel gap, short enough to feel deliberate. */
const CLOSE_DELAY_MS = 150;

type HeaderPanelsValue = {
  active: HeaderPanelId | null;
  pinned: boolean;
  hoverEnabled: boolean;
  isOpen: (id: HeaderPanelId) => boolean;
  /** Opens on hover, unpinned. No-op on coarse pointers. */
  hoverOpen: (id: HeaderPanelId) => void;
  /** Starts the grace period. Ignored while a panel is pinned open. */
  hoverLeave: () => void;
  cancelClose: () => void;
  /** Click behaviour: pin open, or close when already pinned. */
  toggle: (id: HeaderPanelId) => void;
  /** Opens and pins, whatever the current state. Used by the search hand-off. */
  pin: (id: HeaderPanelId) => void;
  close: () => void;
};

const HeaderPanelsContext = createContext<HeaderPanelsValue | null>(null);

/**
 * Hover is a pointer capability, not a screen width: a touch device reports
 * `(hover: none)` regardless of how wide it is, which is exactly the signal
 * needed to switch to tap-only.
 */
function subscribeToHover(onChange: () => void) {
  const query = window.matchMedia("(hover: hover) and (pointer: fine)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function HeaderPanelsProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<HeaderPanelId | null>(null);
  const [pinned, setPinned] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hoverEnabled = useSyncExternalStore(
    subscribeToHover,
    () => window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    () => false,
  );

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const close = useCallback(() => {
    cancelClose();
    setActive(null);
    setPinned(false);
  }, [cancelClose]);

  const hoverOpen = useCallback(
    (id: HeaderPanelId) => {
      if (!hoverEnabled) return;
      cancelClose();
      // A pinned panel keeps its pin when re-entered; hovering a different
      // trigger takes over and drops the pin with it.
      setActive((current) => {
        if (current !== id) setPinned(false);
        return id;
      });
    },
    [hoverEnabled, cancelClose],
  );

  const hoverLeave = useCallback(() => {
    if (!hoverEnabled || pinned) return;
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setActive(null);
    }, CLOSE_DELAY_MS);
  }, [hoverEnabled, pinned, cancelClose]);

  const toggle = useCallback(
    (id: HeaderPanelId) => {
      cancelClose();
      setActive((current) => {
        const alreadyPinnedOpen = current === id && pinned;
        setPinned(!alreadyPinnedOpen);
        return alreadyPinnedOpen ? null : id;
      });
    },
    [pinned, cancelClose],
  );

  const pin = useCallback(
    (id: HeaderPanelId) => {
      cancelClose();
      setActive(id);
      setPinned(true);
    },
    [cancelClose],
  );

  useEffect(() => cancelClose, [cancelClose]);

  useEffect(() => {
    if (!active) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      // Anything belonging to the header panel system marks itself, so a click
      // inside a trigger or its panel is never treated as "outside".
      if (target?.closest("[data-header-panel-root]")) return;
      close();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      close();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [active, close]);

  const value = useMemo<HeaderPanelsValue>(
    () => ({
      active,
      pinned,
      hoverEnabled,
      isOpen: (id) => active === id,
      hoverOpen,
      hoverLeave,
      cancelClose,
      toggle,
      pin,
      close,
    }),
    [active, pinned, hoverEnabled, hoverOpen, hoverLeave, cancelClose, toggle, pin, close],
  );

  return (
    <HeaderPanelsContext.Provider value={value}>{children}</HeaderPanelsContext.Provider>
  );
}

/**
 * Returns null outside the provider so a header control can render standalone
 * — the notification bell is still used on its own in tests.
 */
export function useHeaderPanels(): HeaderPanelsValue | null {
  return useContext(HeaderPanelsContext);
}
