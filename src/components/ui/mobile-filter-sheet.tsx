"use client";

import { Check, SlidersHorizontal, X, type LucideIcon } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useClientMounted, useExitTransition } from "../team/use-exit-transition";
import styles from "./mobile-filter-sheet.module.css";
import { TenantBrandingScope } from "../shell/tenant-branding-provider";

/**
 * The shared filter sheet: the filtered index pages' `Filter` control, and the
 * folder/service picker the Services page uses, are the same surface.
 *
 * Pages whose toolbar already carries a desktop filter affordance (Coupons'
 * Active/Archived tabs) render a `MobileFilterSheet` next to their search box
 * that only appears at mobile widths. Pages whose only filter entry point is
 * this sheet (Clients, Investment Intent) pass `alwaysVisible`: a centered
 * modal on desktop, a bottom sheet on phones. A control that selects one value
 * immediately (Services' folder switcher) uses `MobilePickerSheet` instead --
 * same chrome, same option rows, no Clear/Apply.
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

/** The longest exit transition in the module CSS (the backdrop fade), plus a frame. */
const EXIT_MS = 150;

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/**
 * The modal chrome every sheet and picker shares: backdrop, panel, header,
 * optional footer, and the behaviour a dialog owes its user -- body scroll
 * lock, Escape, click outside, focus moved in on open, Tab kept inside, focus
 * returned to whatever opened it. Reuse this for any new dialog rather than
 * growing another backdrop.
 *
 * Portalled to <body>, mounted only while open or leaving: `useExitTransition`
 * keeps it in the DOM until the exit transition has played, then removes it.
 * Pass `onSubmit` and the body plus footer become one form, so Enter in a text
 * field applies the same way the footer's submit button does.
 */
export function SheetFrame({
  open,
  onClose,
  label,
  eyebrow,
  closeLabel,
  footer,
  onSubmit,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  eyebrow: string;
  closeLabel: string;
  footer?: ReactNode;
  onSubmit?: () => void;
  children: ReactNode;
}) {
  const mounted = useClientMounted();
  const { render, phase } = useExitTransition(open, EXIT_MS);
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  /*
   * Callers pass a fresh closure every render. Reading it through a ref keeps
   * the effect below keyed on `open` alone -- re-running it on every draft
   * change would pull focus back to the first control mid-selection.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    const panel = panelRef.current;
    const returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    /*
     * Keyboard and mouse users land on the first useful control. A touch user
     * lands on the panel itself, so opening a filter does not also summon the
     * on-screen keyboard over half of it.
     */
    const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const firstControl = coarsePointer
      ? null
      : (panel?.querySelector<HTMLElement>("[data-autofocus]") ??
        bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE));
    (firstControl ?? panel)?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !panel) {
        return;
      }

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const outside = !panel.contains(active);

      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusTo?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!mounted || !render) {
    return null;
  }

  /* Pre-entry keeps the base classes; leaving takes the faster exit classes. */
  const stateClass = (openClass?: string, closingClass?: string) =>
    (phase === "open" ? openClass : open ? "" : closingClass) ?? "";

  const content = (
    <>
      <div className={styles.panelBody} ref={bodyRef}>
        {children}
      </div>

      {footer ? <footer className={styles.panelFooter}>{footer}</footer> : null}
    </>
  );

  return createPortal(
    <TenantBrandingScope>
    <div
      className={`${styles.backdrop} ${stateClass(styles.backdropOpen, styles.backdropClosing)}`}
      role="presentation"
      aria-hidden={open ? undefined : true}
      inert={!open}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={panelRef}
        tabIndex={-1}
        className={`${styles.panel} ${stateClass(styles.panelOpen, styles.panelClosing)}`}
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

        {onSubmit ? (
          <form
            className={styles.panelForm}
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            {content}
          </form>
        ) : (
          content
        )}
      </section>
    </div>
    </TenantBrandingScope>,
    document.body,
  );
}

export function MobileFilterSheet({
  label,
  activeCount = 0,
  alwaysVisible = false,
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
   * Show the trigger at every width. For pages where this sheet is the only
   * filter entry point; without it the trigger is mobile-only.
   */
  alwaysVisible?: boolean;
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
        className={[
          styles.trigger,
          alwaysVisible ? styles.triggerAlways : "",
          open ? styles.triggerOpen : "",
        ].join(" ")}
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
        onSubmit={() => {
          onApply();
          close();
        }}
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

            <button type="submit" className={styles.apply}>
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
