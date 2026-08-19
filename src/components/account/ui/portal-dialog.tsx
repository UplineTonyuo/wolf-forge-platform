"use client";

import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

/**
 * The client portal's one modal dialog.
 *
 * Every centered overlay in the portal — New message, the service chooser —
 * renders through this component, so the corner treatment, shadow, easing,
 * entrance and exit durations, keyboard behaviour, outside-click behaviour and
 * reduced-motion handling are defined once rather than three times.
 *
 * Deliberately NOT the native <dialog> element. Tailwind's preflight resets
 * `margin: 0` on every element, which removes the `margin: auto` the user agent
 * relies on to centre a modal <dialog> — that is exactly why the New message
 * modal was pinned to the top-left corner. Owning the positioning here removes
 * the dependency on a UA default a global reset can silently defeat.
 *
 * Children mount only while the dialog is open, so a dialog body keeps its own
 * state per opening and resets naturally on close — no reset effect required.
 */

/**
 * Must match the exit durations in the .portal-overlay rules in globals.css.
 * The feature variant animates further, so it also unmounts later — cutting the
 * timer short would clip the exit rather than play it.
 */
const exitMsFor = (size: PortalDialogSize) => (size === "feature" ? 190 : 140);

/**
 * `feature` is the larger, blurred-backdrop treatment used where the dialog is
 * the point of the interaction rather than a quick form — the cart. It is a
 * variant of this one dialog on purpose: a second modal system would mean a
 * second set of focus, Escape and scroll-lock behaviours to keep correct.
 */
export type PortalDialogSize = "default" | "wide" | "feature";

export function PortalDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  /** Focused on open. Falls back to the first focusable node in the dialog. */
  initialFocusRef,
  /** Set false for flows where a stray backdrop click would lose typed input. */
  closeOnBackdrop = true,
  size = "default",
  /** Renders a close control in the header. Off by default so existing
      dialogs keep the header they were designed with. */
  showClose = false,
  headerAction,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnBackdrop?: boolean;
  size?: PortalDialogSize;
  showClose?: boolean;
  /** Optional control rendered beside the close button, e.g. "Clear cart". */
  headerAction?: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  /*
   * createPortal needs a document, which does not exist during the server
   * render. useSyncExternalStore is the documented way to ask "am I on the
   * client" without a mount effect: the server snapshot is false, the client
   * snapshot is true, and the store never changes.
   */
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  /*
   * Keeps the panel in the DOM while its exit animation runs.
   *
   * Flipped during render using the documented "adjust state when a prop
   * changes" pattern rather than from an effect, so the closing frame is
   * rendered in the same pass the prop changed — an effect would paint one
   * frame with the dialog already gone.
   */
  const [lastOpen, setLastOpen] = useState(open);
  const [exiting, setExiting] = useState(false);

  if (lastOpen !== open) {
    setLastOpen(open);
    setExiting(!open);
  }

  const render = open || exiting;
  const phase = open ? "open" : "closing";

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => setExiting(false), exitMsFor(size));
    return () => clearTimeout(timer);
  }, [exiting, size]);

  const focusables = useCallback(
    () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ),
    [],
  );

  /* Remember what opened the dialog so focus can be handed back on close. */
  useEffect(() => {
    if (!open) return;

    returnFocusRef.current = document.activeElement as HTMLElement | null;

    /*
     * The panel itself, not its first focusable. A dialog whose header carries
     * a destructive action — the cart's "Clear cart" — would otherwise open
     * with that control focused, one Enter away from wiping the contents. A
     * caller that wants a specific field passes initialFocusRef.
     */
    const target = initialFocusRef?.current ?? panelRef.current;
    target?.focus();

    return () => {
      returnFocusRef.current?.focus();
    };
  }, [open, focusables, initialFocusRef]);

  useEffect(() => {
    if (!render) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      // Keep Tab inside the dialog: an overlay the keyboard can walk out of is
      // not modal to anyone using one.
      const nodes = focusables();
      if (nodes.length === 0) return;

      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement;

      const outside = !panelRef.current?.contains(active);

      /*
       * `outside` matters in both directions. Removing a cart row unmounts the
       * button that had focus, which drops it to <body>; without this the next
       * forward Tab walked straight into the page behind the dialog.
       */
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [render, focusables, onClose]);

  if (!mounted || !render) return null;

  return createPortal(
    <div className="portal-overlay" data-phase={phase} data-size={size}>
      <button
        type="button"
        className="portal-overlay-backdrop"
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={closeOnBackdrop ? onClose : undefined}
      />

      <div
        ref={panelRef}
        className="portal-overlay-panel"
        data-size={size}
        // Focusable so the dialog itself can take focus on open.
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header className="portal-overlay-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>

          {headerAction || showClose ? (
            <div className="portal-overlay-head-actions">
              {headerAction}
              {showClose ? (
                <button
                  type="button"
                  className="portal-overlay-close"
                  aria-label="Close"
                  onClick={onClose}
                >
                  <X aria-hidden={true} />
                </button>
              ) : null}
            </div>
          ) : null}
        </header>

        <div className="portal-overlay-body">{children}</div>

        {footer ? <footer className="portal-overlay-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
