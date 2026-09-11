"use client";

import { ChevronRight } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { DepartmentResourceLink } from "./department-resource-link";
import styles from "./department-outputs.module.css";

const MENU_WIDTH = 288;
const VIEWPORT_MARGIN = 12;
const MENU_GAP = 6;

export type DepartmentOutputResource = {
  key: string;
  label: string;
  outputUrl: string | null;
};

type Placement = { left: number; top?: number; bottom?: number; maxHeight: number; above: boolean };

export function DepartmentOutputs({
  resources,
  noun = "output",
}: {
  resources: readonly DepartmentOutputResource[];
  /** Singular noun for this department's links, e.g. "resource" for Website Builder. Defaults to "output" (unchanged for existing callers). */
  noun?: string;
}) {
  const linkedResources = resources.filter((resource) => resource.outputUrl !== null);
  if (linkedResources.length === 0) return <span className={styles.unavailable}>Not available</span>;
  if (linkedResources.length === 1) {
    return (
      <span className={styles.single}>
        <DepartmentResourceLink
          href={linkedResources[0]!.outputUrl!}
          label={`Open ${noun}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        />
      </span>
    );
  }
  return <OutputsMenu resources={linkedResources} noun={noun} />;
}

function OutputsMenu({ resources, noun }: { resources: readonly DepartmentOutputResource[]; noun: string }) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setExiting(true);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setExiting(false), 140);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const availableBelow = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN;
      const availableAbove = rect.top - MENU_GAP - VIEWPORT_MARGIN;
      const openAbove = availableBelow < 180 && availableAbove > availableBelow;
      const maxHeight = Math.max(0, Math.min(280, window.innerHeight - VIEWPORT_MARGIN * 2, openAbove ? availableAbove : availableBelow));
      const menuWidth = Math.min(MENU_WIDTH, window.innerWidth - (VIEWPORT_MARGIN * 2));
      const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.right - menuWidth), window.innerWidth - menuWidth - VIEWPORT_MARGIN);
      // Bottom anchoring uses the panel's actual height, keeping short lists attached.
      setPlacement({ left, maxHeight, above: openAbove,
        ...(openAbove ? { bottom: Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.top + MENU_GAP) }
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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    const handleOtherOpen = () => close();
    document.addEventListener("department-outputs-open", handleOtherOpen);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("department-outputs-open", handleOtherOpen);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open]);

  return (
    <span className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (open) close();
          else {
            document.dispatchEvent(new Event("department-outputs-open"));
            if (closeTimer.current) clearTimeout(closeTimer.current);
            setExiting(false);
            setOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab" && open && !event.shiftKey) {
            const firstLink = menuRef.current?.querySelector<HTMLAnchorElement>("a[href]");
            if (firstLink) { event.preventDefault(); firstLink.focus(); }
          }
          if (event.key === "Enter" || event.key === " ") event.stopPropagation();
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          }
        }}
      >
        <span>{resources.length} {noun}s</span>
        <ChevronRight aria-hidden="true" size={13} />
      </button>
      {(open || exiting) && placement && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="dialog"
              aria-label={`Available ${noun}s`}
              className={styles.menu}
              data-state={open ? "open" : "closing"}
              data-side={placement.above ? "above" : "below"}
              aria-hidden={!open || undefined}
              inert={!open}
              style={{ left: placement.left, top: placement.top, bottom: placement.bottom, maxHeight: placement.maxHeight }}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Tab") {
                  const links = menuRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]");
                  if (links?.length && event.shiftKey && event.target === links[0]) {
                    event.preventDefault(); close(true);
                  } else if (links?.length && !event.shiftKey && event.target === links[links.length - 1]) {
                    close(true);
                  }
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  close(true);
                }
              }}
            >
              <div className={styles.heading}><span>Available {noun}s</span><span className={styles.count}>{resources.length}</span></div>
              <div className={styles.list}>
                {resources.map((resource, index) => (
                  <div className={styles.item} role="none" key={`${resource.key}-${index}`}>
                    <DepartmentResourceLink href={resource.outputUrl!} label={resource.label} className={styles.resource} />
                  </div>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
