"use client";

import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { teamUnreadBadgeLabel } from "../../domain/team/projections";
import type { TeamMessagesChat } from "./use-team-messages-chat";
import styles from "./team-messages.module.css";

/** Drag past this many px still reads as a tap, not a drag. */
const TAP_SLOP_PX = 8;
/** How far the lever's own bar nudges toward the drag direction, as a preview. */
const NUDGE_CAP_PX = 18;
/** Distance commit threshold, as a fraction of the drawer's full width. */
const COMMIT_FRACTION = 0.5;
/** Velocity commit threshold (px/ms) -- a brisk flick commits well short of
 *  the distance threshold, the same way a native sheet would. */
const VELOCITY_COMMIT_PX_MS = 0.5;

type DragState = {
  pointerId: number;
  startX: number;
  dragging: boolean;
  /** Recorded once at drag start; branching stays correct even though
   *  `chat.isOpen` inside the pointermove/pointerup closures is whatever it
   *  was when React last rendered this handler, not necessarily current. */
  wasOpenAtStart: boolean;
  /** The mobile drawer is always `width: 100%`, so the viewport width at
   *  drag start doubles as its px width for the whole gesture. */
  drawerWidth: number;
  lastX: number;
  lastT: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Drag settles committed-open: hand the drawer back to its own CSS
 *  (`.drawerOpen { transform: translateX(0) }`), animated now that the
 *  drag-active override is gone. Does not touch `chat.isOpen` -- either it
 *  was already true (an opening drag completing) or it stays true (a
 *  closing drag aborting back to open). */
function settleOpen(el: HTMLDivElement | null) {
  if (!el) return;
  el.removeAttribute("data-drag-active");
  el.style.transform = "";
}

/** Drag settles committed-closed: slide fully off-screen (animated, same
 *  order-of-operations as settleOpen) and then actually close the chat. */
function settleClosed(el: HTMLDivElement | null, close: () => void) {
  if (el) {
    el.removeAttribute("data-drag-active");
    el.style.transform = "translateX(100%)";
  }
  close();
}

/**
 * Persistent right-edge flat handle that opens/closes the same Team
 * Messages drawer the desktop header button does (see TeamMessagesTrigger
 * and useTeamMessagesChat) -- mobile-only via CSS, so this component is
 * always mounted but only ever paints at <=767px.
 *
 * No icon, no label, no card: the only thing that paints at rest is a thin
 * ~10px edge bar (.leverBar); the button itself is the full ~44px
 * invisible hit target. While Team Messages is open the bar (and its
 * badge) hide -- see .leverOpenState -- but the button's hit zone stays
 * live at the same edge, doubling as the swipe-right-to-close grip instead
 * of a second control floating on top of the open drawer.
 *
 * The drag drives the real `<TeamMessagesDrawer>` root node directly
 * (chat.getDrawerEl/setDrawerEl, written by the drawer's `onRootElement`) so the
 * reveal tracks the finger 1:1 -- not just the lever's own small preview
 * nudge, which stays purely cosmetic.
 */
export function MobileTeamMessagesLever({ chat }: { chat: TeamMessagesChat }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragState | null>(null);

  if (!chat.enabled) {
    return null;
  }

  const badge = teamUnreadBadgeLabel(chat.unread);

  const resetVisual = () => {
    const el = buttonRef.current;
    if (!el) return;
    /*
     * Order matters: .leverDragging pins `transition: transform 0ms` so the
     * live drag tracks the pointer with zero lag. Removing it first restores
     * the base 160ms transform transition, so clearing the inline transform
     * next actually animates the snap-back instead of jumping instantly.
     */
    if (styles.leverDragging) el.classList.remove(styles.leverDragging);
    el.style.transform = "";
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      dragging: false,
      wasOpenAtStart: chat.isOpen,
      drawerWidth: window.innerWidth,
      lastX: event.clientX,
      lastT: performance.now(),
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = drag.startX - event.clientX;

    if (!drag.dragging) {
      if (Math.abs(deltaX) < TAP_SLOP_PX) return;
      drag.dragging = true;
      if (styles.leverDragging) {
        event.currentTarget.classList.add(styles.leverDragging);
      }
      /*
       * Mount as soon as the gesture reads as a drag, not only on commit --
       * the drawer's DOM node has to exist for chat.getDrawerEl() to reach it
       * mid-drag. The very first frame or two (before React commits the
       * mount) has nothing to move yet; every frame after that is 1:1.
       */
      if (!chat.isOpen) chat.openChat();
    }

    drag.lastX = event.clientX;
    drag.lastT = performance.now();

    /* The lever's own bar: a small, capped, purely cosmetic preview nudge. */
    const relevant = drag.wasOpenAtStart ? Math.min(0, deltaX) : Math.max(0, deltaX);
    const nudge = Math.min(Math.abs(relevant), NUDGE_CAP_PX);
    event.currentTarget.style.transform = `translateY(-50%) translateX(${-nudge}px)`;

    /* The real drawer: 1:1 with the pointer, clamped to its own width. */
    const drawerEl = chat.getDrawerEl();
    if (drawerEl) {
      drawerEl.setAttribute("data-drag-active", "true");

      const translatePx = drag.wasOpenAtStart
        ? clamp(event.clientX - drag.startX, 0, drag.drawerWidth)
        : drag.drawerWidth - clamp(deltaX, 0, drag.drawerWidth);

      drawerEl.style.transform = `translateX(${translatePx}px)`;
    }
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resetVisual();

    if (!drag) return;

    if (!drag.dragging) {
      chat.toggle();
      return;
    }

    const drawerEl = chat.getDrawerEl();
    const deltaX = drag.startX - event.clientX;
    const elapsed = Math.max(1, performance.now() - drag.lastT);
    /* px/ms, positive = still moving right (toward closed) at release. */
    const velocity = (event.clientX - drag.lastX) / elapsed;

    if (drag.wasOpenAtStart) {
      const closeAmount = clamp(event.clientX - drag.startX, 0, drag.drawerWidth);
      const committed =
        closeAmount > drag.drawerWidth * COMMIT_FRACTION ||
        velocity > VELOCITY_COMMIT_PX_MS;

      if (committed) settleClosed(drawerEl, chat.close);
      else settleOpen(drawerEl);
    } else {
      const openAmount = clamp(deltaX, 0, drag.drawerWidth);
      const committed =
        openAmount > drag.drawerWidth * COMMIT_FRACTION ||
        -velocity > VELOCITY_COMMIT_PX_MS;

      if (committed) settleOpen(drawerEl);
      else settleClosed(drawerEl, chat.close);
    }
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;

    resetVisual();

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!drag || !drag.dragging) return;

    /* Interrupted gesture: revert to whichever state the drag started in. */
    const drawerEl = chat.getDrawerEl();
    if (drag.wasOpenAtStart) settleOpen(drawerEl);
    else settleClosed(drawerEl, chat.close);
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className={[styles.lever, chat.isOpen ? styles.leverOpenState : ""]
        .filter(Boolean)
        .join(" ")}
      aria-label={
        chat.unread > 0
          ? `Team Messages, ${chat.unread} unread`
          : "Team Messages"
      }
      aria-haspopup="dialog"
      aria-expanded={chat.isOpen}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={handlePointerCancel}
    >
      <span className={styles.leverBar} aria-hidden="true" />

      {badge ? (
        <span
          className={[styles.triggerBadge, styles.triggerBadgeVisible]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}
