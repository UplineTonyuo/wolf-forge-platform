"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

export type TransitionPhase = "open" | "closing";

/**
 * Keep a temporary surface mounted through its exit animation.
 *
 * Same contract as `useAnimatedPopover`, driven by a boolean instead of
 * imperative show/hide calls: `render` says whether the element exists,
 * `phase` drives the CSS class, and a surface asked to close stays mounted
 * for `exitMs` so the outro actually plays before it leaves the DOM.
 *
 * Every state write here is either a render-phase adjustment (React's
 * documented way to derive state from changing props, cheaper than an effect
 * because the intermediate render is never committed) or lives inside a
 * requestAnimationFrame / setTimeout callback. None of them is a synchronous
 * write in an effect body, which is both the lint rule this project enforces
 * and the thing that actually causes cascading renders.
 *
 * The double requestAnimationFrame is what makes the intro run at all: the
 * browser has to paint the hidden state once before a transition to the open
 * state has anything to interpolate from.
 */
export function useExitTransition(open: boolean, exitMs = 180) {
  const [rendered, setRendered] = useState(open);
  const [entered, setEntered] = useState(false);

  if (open && !rendered) setRendered(true);
  if (!rendered && entered) setEntered(false);

  useEffect(() => {
    if (!open || !rendered) return;

    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEntered(true));
    });

    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [open, rendered]);

  useEffect(() => {
    if (open || !rendered) return;

    const timer = window.setTimeout(() => setRendered(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [exitMs, open, rendered]);

  return {
    render: rendered,
    /*
     * Closing is also the pre-entry state, which is what lets one class carry
     * the hidden geometry for both directions while the base class supplies the
     * slower intro timing.
     */
    phase: (open && entered ? "open" : "closing") as TransitionPhase,
  };
}

const subscribeToNothing = () => () => {};

/**
 * True once the browser has taken over from the server.
 *
 * `createPortal` needs a real `document`, and this is the hydration-safe way to
 * ask: the server snapshot is false, the client snapshot is true, and React
 * reconciles the difference itself rather than a `useState` + effect pair that
 * writes state on every mount.
 */
export function useClientMounted(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}
