"use client";

import { ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useExitTransition } from "../team/use-exit-transition";
import styles from "./project-filter-popover.module.css";

const VIEWPORT_MARGIN = 12;
const MENU_GAP = 6;
const MENU_WIDTH = 268;

type Placement = { left: number; top?: number; bottom?: number; maxHeight: number };

/**
 * The one desktop anchored-popover shell every Projects filter selector uses
 * (Person, Client, Status, Service) — trigger, positioning, outside-click,
 * Escape, and open/close motion all live here once instead of once per
 * selector. Content (a plain option list, or Service's folder -> service
 * flow) is supplied by the caller via `render`.
 */
export function ProjectFilterPopover({
  triggerId,
  triggerLabel,
  ariaLabel,
  render,
}: {
  triggerId: string;
  triggerLabel: string;
  ariaLabel: string;
  render: (helpers: { close: () => void }) => ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const { render: renderPanel } = useExitTransition(open, 140);
  /*
   * `useExitTransition`'s own `phase` collapses "mounted but not yet entered"
   * into the same "closing" value as a true exit. Our CSS gives `.menu`'s
   * default (entering) look and `[data-state="closing"]` an independent exit
   * keyframe that starts from fully visible, so applying "closing" during
   * that brief pre-entry window played the exit animation backwards for a
   * frame before the real enter animation cut it off — a visible flicker on
   * open only. Deriving `closing` straight from `open` (matching the
   * hand-rolled pattern in `department-toolbar-filters.tsx` and
   * `project-detail-actions.tsx`) keeps it true only for an actual exit.
   */
  const closing = renderPanel && !open;

  function close() {
    setOpen(false);
  }

  /* Restore focus to the trigger once the popover actually closes, in an
     effect rather than inside the `close` callback itself: `close` is handed
     to the `render` prop and invoked from that arbitrary child content, so a
     ref read inside `close` would count as a ref access during render. */
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!renderPanel) return;

    const positionMenu = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const availableBelow = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN;
      const availableAbove = rect.top - MENU_GAP - VIEWPORT_MARGIN;
      const openAbove = availableBelow < 260 && availableAbove > availableBelow;
      const maxHeight = Math.max(
        0,
        Math.min(360, window.innerHeight - VIEWPORT_MARGIN * 2, openAbove ? availableAbove : availableBelow),
      );
      const menuWidth = Math.min(MENU_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
      const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.left), window.innerWidth - menuWidth - VIEWPORT_MARGIN);

      setPlacement({
        left,
        maxHeight,
        ...(openAbove
          ? { bottom: Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.top + MENU_GAP) }
          : { top: Math.max(VIEWPORT_MARGIN, rect.bottom + MENU_GAP) }),
      });
    };

    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [renderPanel]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        id={triggerId}
        className={open ? `${styles.trigger} ${styles.triggerOpen}` : styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.triggerLabel}>{triggerLabel}</span>
        <ChevronDown aria-hidden="true" size={13} className={styles.caret} />
      </button>

      {renderPanel && placement
        ? createPortal(
            <div
              ref={menuRef}
              role="dialog"
              aria-label={ariaLabel}
              className={styles.menu}
              data-state={closing ? "closing" : "open"}
              style={{
                left: placement.left,
                top: placement.top,
                bottom: placement.bottom,
                maxHeight: placement.maxHeight,
              }}
            >
              {render({ close })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
