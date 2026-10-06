"use client";

import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";
import { useAnimatedPopover } from "./use-animated-popover";

export type RowActionMenuItem =
  | { label: string; href: string }
  | { label: string; onSelect: (trigger: HTMLButtonElement) => void };

/** Compact ellipsis menu (role="menu") shared by list rows and record headers. */
export function RowActionMenu({ name, items }: { name: string; items: RowActionMenuItem[] }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const focusFrameRef = useRef(0);
  const { render, phase, animateOpen, show, showWithoutMotion, hide: hidePopover } = useAnimatedPopover(150);

  /* Cancels a pending first-item focus, or a fast Escape would be undone by it
     and focus would land in the closing menu instead of on the trigger. */
  const hide = useCallback(() => {
    cancelAnimationFrame(focusFrameRef.current);
    hidePopover();
  }, [hidePopover]);

  useEffect(() => {
    if (!render) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) hide();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [hide, render]);

  function focusFirstItem() {
    focusFrameRef.current = requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus());
  }

  function openAndFocus(animate = true) {
    if (animate) show();
    else showWithoutMotion();
    focusFirstItem();
  }

  return (
    <div
      className="clients-row-actions"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && render) {
          event.preventDefault();
          hide();
          triggerRef.current?.focus();
        } else if (
          ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key) &&
          !render
        ) {
          event.preventDefault();
          openAndFocus(false);
        } else if (render && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          focusFirstItem();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) hide();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="clients-row-action-trigger"
        aria-label={`Actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={render && phase === "open"}
        onClick={() => (render ? hide() : openAndFocus(true))}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>

      {render ? (
        <div
          className={phase === "open" ? "clients-row-action-menu is-open" : "clients-row-action-menu"}
          data-open-motion={animateOpen ? "pointer" : "keyboard"}
          role="menu"
          aria-label={`Actions for ${name}`}
        >
          {items.map((item) =>
            "href" in item ? (
              <Link key={item.label} href={item.href} role="menuitem" onClick={hide}>
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  hide();
                  if (triggerRef.current) item.onSelect(triggerRef.current);
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
