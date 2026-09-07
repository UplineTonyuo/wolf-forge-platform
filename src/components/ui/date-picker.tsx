"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAnimatedPopover } from "./use-animated-popover";
import styles from "./date-picker.module.css";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const displayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "long" });
const dayLabelFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type DayCell = { year: number; month: number; day: number; inMonth: boolean };

/**
 * Custom Wolf Forge calendar picker used in place of the native date input.
 * Submits the selected date as YYYY-MM-DD under `name` via a hidden input, so
 * the existing form/server-action contract is unchanged.
 */
export function DatePicker({
  name,
  label,
  value,
  onChange,
  placeholder = "Select a date",
  required = false,
  today,
  menuLabel,
  placement = "below",
  shortcuts = false,
  clearable = false,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (date: string) => void;
  placeholder?: string;
  required?: boolean;
  today?: string;
  menuLabel: string;
  placement?: "above" | "below";
  shortcuts?: boolean;
  clearable?: boolean;
}) {
  const calendarId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { render, phase, show, hide } = useAnimatedPopover();

  const selected = parseDate(value);
  const todayDate = useMemo(
    () => parseDate(today ?? formatISO(new Date())) ?? new Date(),
    [today],
  );

  const [viewYear, setViewYear] = useState(() => (selected ?? todayDate).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (selected ?? todayDate).getMonth());
  const [cursor, setCursor] = useState(() => selected ?? todayDate);

  const isOpen = render && phase === "open";
  const cursorISO = formatISO(cursor);

  // Keyboard entry point is the focused day grid; give it focus on open.
  useEffect(() => {
    if (render) gridRef.current?.focus();
  }, [render]);

  const grid = useMemo(() => {
    const startOffset = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();
    const cells: DayCell[] = [];

    for (let i = 0; i < 42; i++) {
      const dayIndex = i - startOffset + 1;
      if (dayIndex < 1) {
        cells.push({
          year: viewMonth === 0 ? viewYear - 1 : viewYear,
          month: viewMonth === 0 ? 11 : viewMonth - 1,
          day: daysInPrev + dayIndex,
          inMonth: false,
        });
      } else if (dayIndex > daysInMonth) {
        cells.push({
          year: viewMonth === 11 ? viewYear + 1 : viewYear,
          month: viewMonth === 11 ? 0 : viewMonth + 1,
          day: dayIndex - daysInMonth,
          inMonth: false,
        });
      } else {
        cells.push({ year: viewYear, month: viewMonth, day: dayIndex, inMonth: true });
      }
    }
    return cells;
  }, [viewMonth, viewYear]);

  const cursorGridIndex = useMemo(
    () => grid.findIndex((cell) => formatISO(new Date(cell.year, cell.month, cell.day)) === cursorISO),
    [grid, cursorISO],
  );

  function openCalendar() {
    const anchor = selected ?? todayDate;
    setCursor(anchor);
    setViewYear(anchor.getFullYear());
    setViewMonth(anchor.getMonth());
    show();
  }

  function closeCalendar() {
    hide();
    triggerRef.current?.focus();
  }

  function moveCursor(next: Date) {
    setCursor(next);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  function shiftMonth(delta: number) {
    const monthStart = new Date(viewYear, viewMonth + delta, 1);
    const lastDay = new Date(
      monthStart.getFullYear(),
      monthStart.getMonth() + 1,
      0,
    ).getDate();
    moveCursor(
      new Date(
        monthStart.getFullYear(),
        monthStart.getMonth(),
        Math.min(cursor.getDate(), lastDay),
      ),
    );
  }

  function pick(cell: DayCell) {
    onChange(formatISO(new Date(cell.year, cell.month, cell.day)));
    closeCalendar();
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = (delta: number) => {
      event.preventDefault();
      moveCursor(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + delta));
    };

    if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "ArrowRight") step(1);
    else if (event.key === "ArrowUp") step(-7);
    else if (event.key === "ArrowDown") step(7);
    else if (event.key === "Home") {
      const mondayOffset = (cursor.getDay() + 6) % 7;
      step(-mondayOffset);
    } else if (event.key === "End") {
      const mondayOffset = (cursor.getDay() + 6) % 7;
      step(6 - mondayOffset);
    } else if (event.key === "PageUp") {
      event.preventDefault();
      shiftMonth(-1);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      shiftMonth(1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      onChange(formatISO(cursor));
      closeCalendar();
    }
  }

  const monthLabel = monthFormatter.format(new Date(viewYear, viewMonth, 1));
  const taskShortcuts = shortcuts
    ? [
        { label: "Today", date: todayDate },
        {
          label: "Tomorrow",
          date: new Date(
            todayDate.getFullYear(),
            todayDate.getMonth(),
            todayDate.getDate() + 1,
          ),
        },
        {
          label: "Next week",
          date: new Date(
            todayDate.getFullYear(),
            todayDate.getMonth(),
            todayDate.getDate() + 7,
          ),
        },
      ]
    : [];

  return (
    <div
      className={styles.root}
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          hide();
        }
      }}
    >
      <button
        type="button"
        className={styles.trigger}
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`${label}: ${value ? displayFormatter.format(parseDate(value) as Date) : placeholder}`}
        onClick={() => (render ? closeCalendar() : openCalendar())}
      >
        <span className={styles.triggerValue}>
          {value ? displayFormatter.format(parseDate(value) as Date) : placeholder}
        </span>

        <CalendarDays className={styles.triggerIcon} aria-hidden="true" />
      </button>

      <input type="hidden" name={name} value={value} required={required || undefined} />

      {render ? (
        <div
          role="dialog"
          aria-label={menuLabel}
          className={
            isOpen
              ? `${styles.calendar} ${placement === "above" ? styles.calendarAbove : ""} ${styles.calendarOpen}`
              : `${styles.calendar} ${placement === "above" ? styles.calendarAbove : ""} ${styles.calendarClosing}`
          }
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeCalendar();
            }
          }}
        >
          <div className={styles.calendarHeader}>
            <button
              type="button"
              className={styles.navButton}
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>

            <span className={styles.calendarTitle}>
              {monthLabel} {viewYear}
            </span>

            <button
              type="button"
              className={styles.navButton}
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>

          {taskShortcuts.length > 0 ? (
            <div className={styles.shortcuts} aria-label="Quick dates">
              {taskShortcuts.map((shortcut) => {
                const shortcutValue = formatISO(shortcut.date);
                return (
                  <button
                    type="button"
                    key={shortcut.label}
                    aria-pressed={value === shortcutValue}
                    onClick={() => {
                      onChange(shortcutValue);
                      closeCalendar();
                    }}
                  >
                    {shortcut.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className={styles.weekdays}>
            {WEEKDAYS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>

          <div
            ref={gridRef}
            role="grid"
            aria-label="Day grid"
            tabIndex={0}
            aria-activedescendant={cursorGridIndex >= 0 ? `${calendarId}-day-${cursorGridIndex}` : undefined}
            className={styles.days}
            onKeyDown={handleGridKeyDown}
          >
            {grid.map((cell, cellIndex) => {
              const iso = formatISO(new Date(cell.year, cell.month, cell.day));
              const isSelected = iso === value;
              const isToday = iso === formatISO(todayDate);
              const isCursor = iso === cursorISO;
              const classes = [styles.day];
              if (isSelected) classes.push(styles.daySelected);
              if (isToday) classes.push(styles.dayToday);
              if (!cell.inMonth) classes.push(styles.dayMuted);
              if (isCursor && !isSelected) classes.push(styles.dayCursor);

              return (
                <button
                  type="button"
                  id={`${calendarId}-day-${cellIndex}`}
                  key={iso}
                  tabIndex={-1}
                  className={classes.join(" ")}
                  aria-label={dayLabelFormatter.format(new Date(cell.year, cell.month, cell.day))}
                  aria-pressed={isSelected}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => pick(cell)}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          {clearable ? (
            <div className={styles.calendarFooter}>
              <span>
                {value
                  ? `Due ${displayFormatter.format(parseDate(value) as Date)}`
                  : "No due date"}
              </span>
              <button
                type="button"
                disabled={!value}
                onClick={() => {
                  onChange("");
                  closeCalendar();
                }}
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
