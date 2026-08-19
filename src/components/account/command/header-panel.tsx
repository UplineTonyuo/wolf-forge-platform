"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useHeaderPanels, type HeaderPanelId } from "./header-panels";

/**
 * The shared header trigger and its anchored panel.
 *
 * Every floating surface in the client header renders through this pair, so
 * corner radius, shadow, spacing rhythm, entrance and exit animation, and close
 * behaviour are defined once. A panel that opted out of this would be the
 * "patchy" case this replaces.
 */

/** Must match the exit duration on .portal-header-panel in globals.css. */
const EXIT_MS = 150;

export const HeaderPanelTrigger = forwardRef<
  HTMLButtonElement,
  {
    panel: HeaderPanelId;
    label: string;
    children: ReactNode;
    className?: string;
    /** Rendered inside the trigger, e.g. the unread badge. */
    badge?: ReactNode;
  }
>(function HeaderPanelTrigger({ panel, label, children, className, badge }, ref) {
  const panels = useHeaderPanels();
  const open = panels?.isOpen(panel) ?? false;

  return (
    <button
      ref={ref}
      type="button"
      className={["portal-command-button", open ? "is-open" : "", className]
        .filter(Boolean)
        .join(" ")}
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      onPointerEnter={(event) => {
        // Touch fires pointerenter immediately before click; the manager
        // already ignores hover on coarse pointers, and this keeps a stylus or
        // synthetic pointer from opening on contact.
        if (event.pointerType !== "mouse") return;
        panels?.hoverOpen(panel);
      }}
      onPointerLeave={() => panels?.hoverLeave()}
      onFocus={() => panels?.cancelClose()}
      onClick={() => panels?.toggle(panel)}
    >
      {children}
      {badge}
    </button>
  );
});

/**
 * The anchored panel itself.
 *
 * Kept mounted through its exit animation so closing actually plays. Hovering
 * the panel cancels the pending close, which is what lets the pointer travel
 * from the trigger down into the content.
 */
export function HeaderPanel({
  panel,
  label,
  children,
  width = "default",
}: {
  panel: HeaderPanelId;
  label: string;
  children: ReactNode;
  width?: "default" | "wide";
}) {
  const panels = useHeaderPanels();
  const open = panels?.isOpen(panel) ?? false;

  const [lastOpen, setLastOpen] = useState(open);
  const [exiting, setExiting] = useState(false);

  /* Adjust-state-on-prop-change: the closing frame has to render in the same
     pass the panel closed, which an effect would miss by one frame. */
  if (lastOpen !== open) {
    setLastOpen(open);
    setExiting(!open);
  }

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => setExiting(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [exiting]);

  const onPointerEnter = useCallback(() => panels?.cancelClose(), [panels]);
  const onPointerLeave = useCallback(() => panels?.hoverLeave(), [panels]);

  if (!open && !exiting) return null;

  return (
    <div
      className="portal-header-panel"
      data-phase={open ? "open" : "closing"}
      data-width={width}
      role="dialog"
      aria-label={label}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </div>
  );
}

/**
 * Wraps one trigger and its panel.
 *
 * The marker attribute is what the manager's outside-click check looks for, so
 * a click anywhere inside a trigger or its panel is never "outside".
 */
export function HeaderPanelAnchor({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      data-header-panel-root=""
      className={["portal-command-anchor", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}
