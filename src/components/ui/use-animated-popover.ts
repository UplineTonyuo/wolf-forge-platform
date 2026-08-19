"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PopoverPhase = "open" | "closing";

/**
 * Mount/unmount a popover around an open/close transition so the closing
 * animation actually plays before the element is removed from the DOM.
 *
 * `render` says whether the popover exists at all; `phase` drives the CSS
 * class. Opening mounts hidden first (two animation frames) so the browser can
 * paint the hidden state before the in-transition runs.
 */
export function useAnimatedPopover(closeMs = 150) {
  const [render, setRender] = useState(false);
  const [phase, setPhase] = useState<PopoverPhase>("open");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setRender(true);
    setPhase("closing");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase("open"));
    });
  }, []);

  const hide = useCallback(() => {
    if (!render) return;
    setPhase("closing");
    timerRef.current = setTimeout(() => {
      setRender(false);
      timerRef.current = null;
    }, closeMs);
  }, [closeMs, render]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { render, phase, show, hide };
}
