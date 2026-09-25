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
  const [animateOpen, setAnimateOpen] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = useRef<number | null>(null);
  /*
   * A click handler or a blur raised while the tree is being torn down can
   * still call in after unmount; the callbacks check this before writing state
   * so none of them runs against a destroyed environment.
   */
  const mountedRef = useRef(true);

  const open = useCallback((animate: boolean) => {
    if (!mountedRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setAnimateOpen(animate);
    setRender(true);
    if (!animate) {
      setPhase("open");
      return;
    }
    setPhase("closing");
    frameRef.current = requestAnimationFrame(() => {
      if (!mountedRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        if (mountedRef.current) setPhase("open");
      });
    });
  }, []);

  const show = useCallback(() => open(true), [open]);
  const showWithoutMotion = useCallback(() => open(false), [open]);

  const hide = useCallback(() => {
    if (!mountedRef.current || !render) return;
    setPhase("closing");
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!mountedRef.current) return;
      setRender(false);
    }, closeMs);
  }, [closeMs, render]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return { render, phase, animateOpen, show, showWithoutMotion, hide };
}
