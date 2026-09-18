"use client";

import { Check, SlidersHorizontal, X, type LucideIcon } from "lucide-react";
import {
  ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import styles from "./mobile-filter-sheet.module.css";

/**
 * The shared mobile sheet: the filtered index pages' `Filter` control, and the
 * folder/service picker the Services page uses, are the same surface.
 *
 * Pages that already carry a filter affordance in their own toolbar (the
 * Active/Archived tabs, the Investment Intent status pills) render a
 * `MobileFilterSheet` next to their search box at mobile widths and keep their
 * richer desktop controls hidden at those widths. A control that selects one
 * value immediately (Services' folder switcher) uses `MobilePickerSheet`
 * instead -- same chrome, same option rows, no Clear/Apply.
 *
 * Both are portalled to <body> on purpose. Inside a route the sheet would be a
 * `position: fixed` descendant of `.workspace-route-stage`, which carries a
 * transform for the route transition and is therefore its containing block --
 * the sheet would anchor to the page column instead of the viewport.
 */
export type MobileFilterOption = {
  value: string;
  label: string;
  /** An authoritative count the page already computes. Omitted when there is none. */
  count?: number;
  /**
   * Optional leading glyph, from the project's lucide vocabulary. Options
   * without one keep the icon-less row rhythm -- the icon column is only
   * reserved when at least one option in the group actually has an icon.
   */
  icon?: LucideIcon;
};

export function FilterOptionGroup({
  label,
  options,
  value,
  onChange,
  showLabel = true,
  selectedTone = "accent",
}: {
  /** Names the group for assistive tech. Also its visible label unless `showLabel` is off. */
  label: string;
  options: MobileFilterOption[];
  value: string;
  onChange: (value: string) => void;
  /** Off when the sheet's own heading already says it, as in a picker. */
  showLabel?: boolean;
  /**
   * `accent` is the gold wash the filter sheets use for an applied filter.
   * `navy` is the quieter tint a picker uses for the current value, where the
   * row is a location rather than an active filter and gold would read as a
   * status.
   */
  selectedTone?: "accent" | "navy";
}) {
  const hasIcons = options.some((option) => option.icon);

  return (
    <div className={styles.group}>
      {showLabel ? <span className={styles.groupLabel}>{label}</span> : null}

      <div className={styles.optionList} role="group" aria-label={label}>
        {options.map((option) => {
          const selected = option.value === value;
          const OptionIcon = option.icon;
          const selectedClass =
            selectedTone === "navy"
              ? styles.optionRowSelectedNavy
              : styles.optionRowSelected;

          return (
            <button
              key={`${label}-${option.value || "__all"}`}
              type="button"
              className={
                selected
                  ? `${styles.optionRow} ${selectedClass}`
                  : styles.optionRow
              }
              data-icon={hasIcons ? "true" : undefined}
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
            >
              {OptionIcon ? (
                <span className={styles.optionIcon} aria-hidden="true">
                  <OptionIcon />
                </span>
              ) : null}

              <span className={styles.optionLabel}>{option.label}</span>

              {option.count === undefined ? null : (
                <span className={styles.optionCount}>{option.count}</span>
              )}

              <span className={styles.optionCheck} aria-hidden="true">
                {selected ? <Check size={15} /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The sheet chrome itself: backdrop, panel, header, optional footer, and the
 * open/close behaviour both callers share (body scroll lock, Escape, click
 * outside). Rendered through a portal, and always mounted so it can transition
 * out -- `aria-hidden` is what takes it out of the accessibility tree when it
 * is closed.
 */
function SheetFrame({
  open,
  onClose,
  label,
  eyebrow,
  closeLabel,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  eyebrow: string;
  closeLabel: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  const sheet = (
    <div
      className={open ? `${styles.backdrop} ${styles.backdropOpen}` : styles.backdrop}
      role="presentation"
      aria-hidden={!open}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className={open ? `${styles.panel} ${styles.panelOpen}` : styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <div className={styles.goldLine} aria-hidden="true" />

        <header className={styles.panelHeader}>
          <div className={styles.panelHeading}>
            <span className={styles.eyebrow}>{eyebrow}</span>
            <h2>{label}</h2>
          </div>

          <button
            type="button"
            className={styles.closeButton}
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className={styles.panelBody}>{children}</div>

        {footer ? <footer className={styles.panelFooter}>{footer}</footer> : null}
      </section>
    </div>
  );

  return mounted ? createPortal(sheet, document.body) : null;
}

export function MobileFilterSheet({
  label,
  activeCount = 0,
  onOpen,
  onClear,
  onApply,
  children,
}: {
  /** Accessible name for the trigger and the sheet, e.g. "Filter coupons". */
  label: string;
  /** Drives the badge. Pages pass their own count, or 0 for none. */
  activeCount?: number;
  /**
   * Fired as the sheet opens. Pages that edit a draft-selection hold their
   * option rows in local state, and this is where that draft is reseeded from
   * the filter that is actually applied -- otherwise a sheet the user closed
   * without applying would reopen showing the abandoned selection.
   */
  onOpen?: () => void;
  /** Returns every filter to its default. Applied immediately, then closed. */
  onClear: () => void;
  /** Commits the draft the option rows have been editing. */
  onApply: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className={
          open ? `${styles.trigger} ${styles.triggerOpen}` : styles.trigger
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          if (!open) {
            onOpen?.();
          }

          setOpen((current) => !current);
        }}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span>Filter</span>

        {activeCount > 0 ? (
          <span className={styles.badge}>{activeCount}</span>
        ) : null}
      </button>

      <SheetFrame
        open={open}
        onClose={close}
        label={label}
        eyebrow="FILTERS"
        closeLabel="Close filters"
        footer={
          <>
            <button
              type="button"
              className={styles.clear}
              onClick={() => {
                onClear();
                close();
              }}
            >
              Clear
            </button>

            <button
              type="button"
              className={styles.apply}
              onClick={() => {
                onApply();
                close();
              }}
            >
              Apply
            </button>
          </>
        }
      >
        {children}
      </SheetFrame>
    </>
  );
}

/**
 * A sheet that selects exactly one value and closes. Used where the control
 * starts from a custom trigger of its own -- the Services folder switcher is
 * the folder summary card, not a generic pill -- so this component is
 * controlled by its caller and owns no trigger.
 *
 * `onSelect` fires immediately: there is no draft and no Apply, because there
 * is nothing to stage -- choosing a folder is the whole action.
 */
export function MobilePickerSheet({
  open,
  onClose,
  label,
  eyebrow,
  closeLabel,
  options,
  value,
  onSelect,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Also the sheet's heading, e.g. "Select folder". */
  label: string;
  eyebrow: string;
  closeLabel: string;
  options: MobileFilterOption[];
  value: string;
  onSelect: (value: string) => void;
  /** Extra rows below the list, e.g. the "New folder" escape hatch. */
  children?: ReactNode;
}) {
  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      label={label}
      eyebrow={eyebrow}
      closeLabel={closeLabel}
    >
      <FilterOptionGroup
        label={label}
        showLabel={false}
        options={options}
        value={value}
        selectedTone="navy"
        onChange={(next) => {
          onSelect(next);
          onClose();
        }}
      />

      {children}
    </SheetFrame>
  );
}
