"use client";

import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import styles from "./department-toolbar-filters.module.css";

const MENU_WIDTH = 240;
const VIEWPORT_MARGIN = 12;
const MENU_GAP = 6;

export type DepartmentToolbarFilterGroup = {
  key: string;
  /** Group heading inside the panel, e.g. "Package". */
  label: string;
  /** The "no filter" option's own visible label, e.g. "All Packages". */
  allLabel: string;
  /** Accessible name for this group's option list, e.g. "Filter by SEO package". */
  ariaLabel: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
};

type Placement = { left: number; top?: number; bottom?: number; maxHeight: number; above: boolean };

/**
 * The shared secondary-filter control that sits in a department toolbar
 * next to search/VA/status — a single "Filters" trigger hiding one or more
 * option groups (today, just SEO package) that don't need to occupy
 * permanent toolbar space. Modeled on `DepartmentOutputs`' resource
 * popover: same anchored/flip/clamp positioning, 140ms enter/exit, outside
 * click + Escape + trigger-focus restoration, and reduced-motion support —
 * not a copy of that component, since its content (a single-select option
 * list vs. resource links) is different enough to not share JSX, but the
 * interaction contract stays identical so every Wolf Forge Operations
 * popover behaves the same way. A single-level option list, not a nested
 * `AnimatedSelect`, keeps that contract simple to maintain here.
 */
export function DepartmentToolbarFilters({ groups }: { groups: readonly DepartmentToolbarFilterGroup[] }) {
  const panelId = useId();
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
      const openAbove = availableBelow < 220 && availableAbove > availableBelow;
      const maxHeight = Math.max(0, Math.min(360, window.innerHeight - VIEWPORT_MARGIN * 2, openAbove ? availableAbove : availableBelow));
      const menuWidth = Math.min(MENU_WIDTH, window.innerWidth - (VIEWPORT_MARGIN * 2));
      const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.left), window.innerWidth - menuWidth - VIEWPORT_MARGIN);
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
    document.addEventListener("department-toolbar-filters-open", handleOtherOpen);
    document.addEventListener("department-outputs-open", handleOtherOpen);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("department-toolbar-filters-open", handleOtherOpen);
      document.removeEventListener("department-outputs-open", handleOtherOpen);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open]);

  if (groups.length === 0) return null;
  const activeCount = groups.filter((group) => group.value !== "all").length;

  return (
    <span className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (open) close();
          else {
            document.dispatchEvent(new Event("department-toolbar-filters-open"));
            document.dispatchEvent(new Event("department-outputs-open"));
            if (closeTimer.current) clearTimeout(closeTimer.current);
            setExiting(false);
            setOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            close(true);
          }
        }}
      >
        <span>Filters{activeCount > 0 ? ` · ${activeCount}` : ""}</span>
        <ChevronDown aria-hidden="true" size={13} className={styles.caret} />
      </button>
      {(open || exiting) && placement && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={panelId}
              role="dialog"
              aria-label="Filters"
              className={styles.menu}
              data-state={open ? "open" : "closing"}
              data-side={placement.above ? "above" : "below"}
              aria-hidden={!open || undefined}
              inert={!open}
              style={{ left: placement.left, top: placement.top, bottom: placement.bottom, maxHeight: placement.maxHeight }}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  event.preventDefault();
                  close(true);
                }
              }}
            >
              <div className={styles.heading}>FILTERS</div>
              <div className={styles.groups}>
                {groups.map((group) => (
                  <div className={styles.group} key={group.key}>
                    <div className={styles.groupLabel}>{group.label}</div>
                    <div className={styles.optionList} role="group" aria-label={group.ariaLabel}>
                      <FilterOption
                        label={group.allLabel}
                        selected={group.value === "all"}
                        onSelect={() => {
                          group.onChange("all");
                          close(true);
                        }}
                      />
                      {group.options.map((option) => (
                        <FilterOption
                          key={option}
                          label={option}
                          selected={group.value === option}
                          onSelect={() => {
                            group.onChange(option);
                            close(true);
                          }}
                        />
                      ))}
                    </div>
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

function FilterOption({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={selected ? `${styles.option} ${styles.optionSelected}` : styles.option}
      aria-pressed={selected}
      onClick={onSelect}
      title={label}
    >
      <span className={styles.optionLabel}>{label}</span>
      {selected ? <Check aria-hidden="true" size={13} className={styles.optionCheck} /> : null}
    </button>
  );
}
