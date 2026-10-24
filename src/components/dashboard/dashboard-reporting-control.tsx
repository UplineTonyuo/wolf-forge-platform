"use client";

import { ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DashboardPreset } from "../../domain/dashboard/schema";
import {
  monthCellLabel,
  monthCellYear,
  monthKeyOf,
  rangeFromMonths,
  reportingButtonLabel,
  reportingMonthCells,
  reportingPresetOptions,
  reportingRangeSummary,
  yearToDateRange,
} from "../../lib/dashboard/reporting-presets";
import styles from "./dashboard-reporting-control.module.css";

/**
 * How long the popover's closing transition runs, in milliseconds. Must stay in
 * step with the closed-state `transition-duration` in the stylesheet: it is the
 * window the element is held in the DOM so the exit is visible.
 */
const POPOVER_EXIT_MS = 130;

/**
 * `closing` is the popover animating out. It is still mounted and still
 * measured, it just no longer takes pointer input.
 */
type PopoverPhase = "closed" | "open" | "closing";

/**
 * The Dashboard's single reporting-period control.
 *
 * One compact button opens one popover holding every option, so the header
 * never carries a permanent row of preset pills. It fetches nothing: it only
 * writes the existing reporting contract (`?period=`, plus `?from=`/`?to=` for
 * a custom range) and lets the server component re-resolve the window.
 *
 * This is analytics only. The command-bar calendar icon remains the
 * Subscription calendar and shares no state with this control.
 */
export function DashboardReportingControl({
  preset,
  businessToday,
}: {
  preset: DashboardPreset;
  /** Today's Asia/Manila business date, resolved on the server. */
  businessToday: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;
  const date = searchParams.get("date") ?? undefined;
  const servicesPeriod = searchParams.get("servicesPeriod");
  const servicesSuffix = servicesPeriod && ["week", "month", "year"].includes(servicesPeriod)
    ? `&servicesPeriod=${servicesPeriod}` : "";
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<PopoverPhase>("closed");
  const exitTimerRef = useRef<number | null>(null);
  const open = phase === "open";
  const [view, setView] = useState<"menu" | "range">("menu");
  const [anchorMonth, setAnchorMonth] = useState<string | null>(null);
  const [focusMonth, setFocusMonth] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [awaitingRangeEnd, setAwaitingRangeEnd] = useState(false);
  const dragExtendedRef = useRef(false);
  const [placement, setPlacement] = useState<{
    top: number;
    right: number;
    sheet: boolean;
    /** Distance in px from the popover's right edge to the trigger's centre. */
    originX: number;
    originY: "top" | "bottom";
  }>({ top: 0, right: 0, sheet: false, originX: 0, originY: "top" });

  const activeRange = useMemo(
    () => (preset === "custom_range" && from && to ? { from, to } : null),
    [preset, from, to],
  );
  const label = reportingButtonLabel({ preset, from, to, date });

  const currentYear = Number(businessToday.slice(0, 4));

  const [displayYear, setDisplayYear] = useState(() => {
    const activeYear = activeRange
      ? Number(activeRange.from.slice(0, 4))
      : currentYear;

    return Number.isFinite(activeYear)
      ? Math.min(activeYear, currentYear)
      : currentYear;
  });

  const months = reportingMonthCells(
    businessToday,
    undefined,
    { year: displayYear },
  );

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();

    const top = rect.bottom + 9;
    const right = Math.max(12, window.innerWidth - rect.right);

    /*
     * The popover is right-anchored, so its own right edge sits at
     * `innerWidth - right`. Measuring back from there to the trigger's centre
     * gives the horizontal origin, and the vertical origin is read from where
     * the popover actually landed relative to the trigger rather than assumed.
     */
    const popoverRight = window.innerWidth - right;
    const triggerCentreX = rect.left + rect.width / 2;

    setPlacement({
      top,
      right,
      sheet: window.innerWidth <= 560,
      originX: Math.max(0, popoverRight - triggerCentreX),
      originY: top >= rect.bottom ? "top" : "bottom",
    });
  }, [setPlacement]);

  /*
   * Closing hands the popover to CSS and keeps it mounted for the length of the
   * exit. Re-opening before that lands cancels the timer, so the popover
   * retargets from wherever it currently sits instead of restarting.
   */
  const close = useCallback(() => {
    setDragging(false);
    setPhase((current) => (current === "open" ? "closing" : current));

    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);

    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      setPhase((current) => (current === "closing" ? "closed" : current));
    }, POPOVER_EXIT_MS);
  }, [setDragging, setPhase]);

  /* Reopening a live custom range starts the drag UI on its own months. */
  const openMenu = useCallback(() => {
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }

    measure();
    setView("menu");
    setAnchorMonth(activeRange ? monthKeyOf(activeRange.from) : null);
    setFocusMonth(activeRange ? monthKeyOf(activeRange.to) : null);
    setPhase("open");
  }, [activeRange, measure, setAnchorMonth, setFocusMonth, setPhase, setView]);

  useEffect(() => () => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      close();
    };

    const onPointerUp = () => {
      setDragging(false);

      if (dragExtendedRef.current) {
        setAwaitingRangeEnd(false);
        dragExtendedRef.current = false;
      }
    };
    const onReposition = () => measure();

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [close, measure, open]);

  const applyPreset = (next: DashboardPreset) => {
    close();
    router.push(`/dashboard?period=${next}${servicesSuffix}`, { scroll: false });
  };

  const yearlyRange = yearToDateRange(businessToday);
  const yearlyActive =
    preset === "custom_range" &&
    from === yearlyRange.from &&
    to === yearlyRange.to;

  const applyYearly = () => {
    close();
    router.push(
      `/dashboard?period=custom_range&from=${yearlyRange.from}&to=${yearlyRange.to}${servicesSuffix}`,
      { scroll: false },
    );
  };

  const draft = anchorMonth && focusMonth
    ? rangeFromMonths(anchorMonth, focusMonth, businessToday)
    : null;

  const draftMonths = anchorMonth && focusMonth
    ? [anchorMonth, focusMonth].sort()
    : null;

  const applyRange = () => {
    if (!draft) return;
    close();
    router.push(
      `/dashboard?period=custom_range&from=${draft.from}&to=${draft.to}${servicesSuffix}`,
      { scroll: false },
    );
  };

  const beginAt = (monthKey: string) => {
    /*
     * If a start month is waiting for an endpoint, this press
     * completes the range instead of resetting it.
     */
    if (awaitingRangeEnd) {
      setFocusMonth(monthKey);
      setDragging(false);
      setAwaitingRangeEnd(false);
      dragExtendedRef.current = false;
      return;
    }

    /*
     * Start a fresh selection.
     * The user can either release and tap an end month,
     * or keep dragging across the grid.
     */
    setAnchorMonth(monthKey);
    setFocusMonth(monthKey);
    setDragging(true);
    setAwaitingRangeEnd(true);
    dragExtendedRef.current = false;
  };

  const extendTo = (monthKey: string) => {
    if (!dragging) return;

    if (monthKey !== anchorMonth) {
      dragExtendedRef.current = true;
    }

    setFocusMonth(monthKey);
  };

  /*
   * Keyboard activation reports detail 0. The first Enter/Space sets the start
   * month, the next one sets the end, so the range is reachable without a
   * pointer.
   */
  const keyboardSelect = (monthKey: string) => {
    if (!awaitingRangeEnd) {
      setAnchorMonth(monthKey);
      setFocusMonth(monthKey);
      setAwaitingRangeEnd(true);
      return;
    }

    setFocusMonth(monthKey);
    setAwaitingRangeEnd(false);
  };

  /*
   * The origin is written as a custom property so the stylesheet keeps every
   * other transform concern (including the mobile sheet, which overrides it).
   */
  const popoverStyle = placement.sheet
    ? undefined
    : ({
        top: placement.top,
        right: placement.right,
        "--wf-report-origin":
          `calc(100% - ${placement.originX}px) ${placement.originY}`,
      } as CSSProperties);

  const popover = (
    <div
      ref={popoverRef}
      className={styles.popover}
      data-sheet={placement.sheet ? "true" : undefined}
      data-state={open ? "open" : "closed"}
      data-view={view}
      style={popoverStyle}
      role="dialog"
      aria-label="Reporting period"
    >
      {view === "menu" ? (
        <div className={styles.menu} role="menu" aria-label="Reporting period options">
          {reportingPresetOptions.map((option) => (
            <button
              key={option.preset}
              type="button"
              role="menuitemradio"
              aria-checked={preset === option.preset}
              className={styles.menuItem}
              data-active={preset === option.preset ? "true" : undefined}
              onClick={() => applyPreset(option.preset)}
            >
              <span>{option.label}</span>
              {preset === option.preset ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          ))}

          <button
            type="button"
            role="menuitemradio"
            aria-checked={yearlyActive}
            className={styles.menuItem}
            data-active={yearlyActive ? "true" : undefined}
            onClick={applyYearly}
          >
            <span>Yearly</span>
            {yearlyActive ? <Check size={14} aria-hidden="true" /> : null}
          </button>

          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            data-active={activeRange ? "true" : undefined}
            onClick={() => {
              const currentMonth = monthKeyOf(businessToday);

              const fromMonth = activeRange
                ? monthKeyOf(activeRange.from)
                : currentMonth;

              const toMonth = activeRange
                ? monthKeyOf(activeRange.to)
                : currentMonth;

              setAnchorMonth(fromMonth);
              setFocusMonth(toMonth);

              const selectedYear = Number(fromMonth.slice(0, 4));

              setDisplayYear(
                Number.isFinite(selectedYear)
                  ? Math.min(selectedYear, currentYear)
                  : currentYear,
              );

              setAwaitingRangeEnd(false);
              setView("range");
            }}
          >
            <span>Range</span>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className={styles.range}>
          <header className={styles.rangeHead}>
            <button
              type="button"
              className={styles.back}
              aria-label="Back to reporting options"
              onClick={() => setView("menu")}
            >
              <ArrowLeft size={14} aria-hidden="true" />
            </button>

            <div>
              <span>CUSTOM REPORTING RANGE</span>
              <strong>
                {draft
                  ? reportingRangeSummary(draft.from, draft.to)
                  : "Drag across the months"}
              </strong>
            </div>
          </header>

          <div
            className={styles.yearNavigator}
            aria-label="Reporting range year"
          >
            <button
              type="button"
              aria-label="Previous year"
              onClick={() => setDisplayYear((year) => year - 1)}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>

            <strong>{displayYear}</strong>

            <button
              type="button"
              aria-label="Next year"
              disabled={displayYear >= currentYear}
              onClick={() =>
                setDisplayYear((year) =>
                  Math.min(year + 1, currentYear)
                )
              }
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          <div
            className={styles.months}
            onPointerLeave={() => setDragging(false)}
          >
            {months.map((monthKey) => {
              const inRange = Boolean(
                draftMonths && monthKey >= draftMonths[0]! && monthKey <= draftMonths[1]!,
              );

              return (
                <button
                  key={monthKey}
                  type="button"
                  className={styles.month}
                  aria-pressed={inRange}
                  data-in-range={inRange ? "true" : undefined}
                  data-start={draftMonths?.[0] === monthKey ? "true" : undefined}
                  data-end={draftMonths?.[1] === monthKey ? "true" : undefined}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    beginAt(monthKey);
                  }}
                  onPointerEnter={() => extendTo(monthKey)}
                  onClick={(event) => {
                    if (event.detail === 0) keyboardSelect(monthKey);
                  }}
                >
                  <span>{monthCellLabel(monthKey)}</span>
                  <small>{monthCellYear(monthKey)}</small>
                </button>
              );
            })}
          </div>

          <footer className={styles.rangeFoot}>
            <button type="button" className={styles.secondary} onClick={() => setView("menu")}>
              Back
            </button>

            <button
              type="button"
              className={styles.apply}
              disabled={!draft}
              onClick={applyRange}
            >
              Apply range
            </button>
          </footer>
        </div>
      )}
    </div>
  );

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Reporting period: ${label}`}
        onClick={() => (open ? close() : openMenu())}
      >
        <span className={styles.triggerLabel}>{label}</span>
        <ChevronDown size={14} aria-hidden="true" className={styles.chevron} />
      </button>

      {/*
        Only rendered from a click, so the portal never runs during SSR. It
        outlives `open` by the length of the exit transition.
      */}
      {phase !== "closed" && typeof document !== "undefined"
        ? createPortal(popover, document.body)
        : null}
    </div>
  );
}
