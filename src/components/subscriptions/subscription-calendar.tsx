"use client";

import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Repeat2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { SubscriptionCalendarResult } from "../../app/actions/subscription-calendar";
import {
  addMonthsToMonthKey,
  buildSubscriptionCalendarMonth,
  daysInMonth,
  mondayFirstWeekday,
  monthLabel,
  parseMonthKey,
  toDateKey,
  type SubscriptionCalendarEntry,
  type SubscriptionCalendarPerspective,
  type SubscriptionCalendarSource,
} from "../../domain/subscriptions/calendar";
import { formatCurrencyCents } from "../../lib/format";
import { subscriptionStatusLabels } from "../../lib/subscriptions/presentation";
import styles from "./subscription-calendar.module.css";

const weekdayLabels = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const closeAnimationMs = 190;

/**
 * The two sides of the same billing relationship, in one table rather than
 * scattered ternaries.
 *
 * Owner/Admin reads money coming in, so it is revenue and it counts what is
 * new. A client reads money going out, so it is a subscription total and it
 * counts what is due — the same projection, described from the payer's side.
 * Nothing here changes which rows are visible: that is settled by RLS and by
 * the perspective the service already applies to the source fields.
 */
const calendarCopy = {
  owner: {
    eyebrow: "Recurring revenue calendar",
    unit: (count: number) => (count === 1 ? "1 subscription" : `${count} subscriptions`),
    dayUnit: (count: number) => `${count} subscription${count === 1 ? "" : "s"}`,
    empty: "No subscriptions on this date.",
    loading: "Loading subscriptions...",
    monthlyTotal: "MONTHLY RECURRING REVENUE",
    annualTotal: "ANNUAL RECURRING REVENUE",
    activeLabel: "ACTIVE SUBSCRIPTIONS",
    fourthLabel: "NEW THIS MONTH",
  },
  client: {
    eyebrow: "My subscription calendar",
    unit: (count: number) => (count === 1 ? "1 PAYMENT" : `${count} PAYMENTS`),
    dayUnit: (count: number) => `${count} payment${count === 1 ? "" : "s"}`,
    empty: "No subscription payments due on this date.",
    loading: "Loading your subscriptions...",
    monthlyTotal: "MONTHLY SUBSCRIPTION TOTAL",
    annualTotal: "ANNUAL SUBSCRIPTION TOTAL",
    activeLabel: "ACTIVE SUBSCRIPTIONS",
    fourthLabel: "DUE THIS MONTH",
  },
} as const satisfies Record<SubscriptionCalendarPerspective, unknown>;

function todayKey(): string {
  const now = new Date();
  return toDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function formatDayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);

  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)));
}

function DayDots({ entries }: { entries: SubscriptionCalendarEntry[] }) {
  const shown = entries.slice(0, 3);
  const overflow = entries.length - shown.length;

  return (
    <span className={styles.dots}>
      {shown.map((entry) => (
        <span
          key={entry.key}
          className={styles.dot}
          data-cadence={entry.cadence}
          aria-hidden="true"
        />
      ))}

      {overflow > 0 ? <span className={styles.dotCount}>+{overflow}</span> : null}
    </span>
  );
}

function EntryCard({
  entry,
  perspective,
}: {
  entry: SubscriptionCalendarEntry;
  perspective: SubscriptionCalendarPerspective;
}) {
  const isOwner = perspective === "owner";
  const heading = isOwner ? entry.companyName ?? entry.publicRef : entry.items[0]?.name ?? entry.publicRef;
  const secondary = isOwner ? null : entry.providerName;

  return (
    <article className={styles.entry} data-cadence={entry.cadence}>
      <header className={styles.entryHead}>
        <span className={styles.entryIcon} aria-hidden="true">
          {isOwner ? <Building2 size={15} /> : <Repeat2 size={15} />}
        </span>

        <div className={styles.entryTitle}>
          <strong>{heading}</strong>
          {secondary ? <span>{secondary}</span> : null}
        </div>

        {entry.status !== "active" ? (
          <span className={styles.entryStatus} data-status={entry.status}>
            {subscriptionStatusLabels[entry.status]}
          </span>
        ) : null}
      </header>

      <ul className={styles.entryItems}>
        {entry.items.map((item, index) => (
          <li key={`${entry.key}-${index}`}>
            <span>
              {item.name}
              {item.quantity > 1 ? <small> x{item.quantity}</small> : null}
            </span>
            <span>{formatCurrencyCents(item.netAmountCents, entry.currency)}</span>
          </li>
        ))}
      </ul>

      <footer className={styles.entryFoot}>
        <strong>{formatCurrencyCents(entry.amountCents, entry.currency)}</strong>
        <span className={styles.entryCadence} data-cadence={entry.cadence}>
          {entry.perUnitLabel}
        </span>
        <span className={styles.entryRef}>{entry.cadenceLabel}</span>
      </footer>
    </article>
  );
}

export function SubscriptionCalendarPanel({
  perspective,
  sources,
  loading,
  error,
  initialMonthKey,
}: {
  perspective: SubscriptionCalendarPerspective;
  sources: SubscriptionCalendarSource[];
  loading: boolean;
  error: string | null;
  initialMonthKey?: string;
}) {
  const today = useMemo(() => todayKey(), []);

  const [monthKey, setMonthKey] = useState(
    () => initialMonthKey ?? today.slice(0, 7),
  );
  const [direction, setDirection] = useState<"next" | "previous">("next");
  const [selection, setSelection] = useState<{ monthKey: string; date: string } | null>(null);

  const month = useMemo(
    () => buildSubscriptionCalendarMonth(sources, monthKey, perspective),
    [monthKey, perspective, sources],
  );

  const grid = useMemo(() => {
    const parsed = parseMonthKey(monthKey);
    if (!parsed) return { lead: 0, days: [] as string[] };

    return {
      lead: mondayFirstWeekday(parsed.year, parsed.month, 1),
      days: Array.from({ length: daysInMonth(parsed.year, parsed.month) }, (_, index) =>
        toDateKey(parsed.year, parsed.month, index + 1),
      ),
    };
  }, [monthKey]);

  /*
   * The selected day is derived, not synchronised in an effect: an explicit
   * click wins while its month is visible, otherwise the month falls back to
   * today, then to its first day that actually bills, so navigating never
   * lands on an arbitrary blank panel.
   */
  const selectedDate = selection?.monthKey === monthKey
    ? selection.date
    : today.slice(0, 7) === monthKey
      ? today
      : grid.days.find((day) => month.entriesByDate[day]?.length) ?? grid.days[0] ?? null;

  const goToMonth = useCallback((delta: number) => {
    setDirection(delta > 0 ? "next" : "previous");
    setMonthKey((current) => addMonthsToMonthKey(current, delta));
  }, []);

  const selectedEntries = selectedDate
    ? month.entriesByDate[selectedDate] ?? []
    : [];

  const totals = month.summary.recurringTotals;
  const headline = totals[0];
  const extraTotals = totals.slice(1);
  const isOwner = perspective === "owner";
  const copy = calendarCopy[perspective];

  return (
    <div className={styles.panel}>
      <header className={styles.head}>
        <div className={styles.headCopy}>
          <span>{copy.eyebrow}</span>
          <h2 key={monthKey} className={styles.monthTitle}>
            {monthLabel(monthKey)}
          </h2>
        </div>

        <div className={styles.nav}>
          <button
            type="button"
            className={styles.navButton}
            aria-label="Previous month"
            onClick={() => goToMonth(-1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            className={styles.today}
            onClick={() => {
              setDirection(today.slice(0, 7) < monthKey ? "previous" : "next");
              setMonthKey(today.slice(0, 7));
              setSelection({ monthKey: today.slice(0, 7), date: today });
            }}
          >
            Today
          </button>

          <button
            type="button"
            className={styles.navButton}
            aria-label="Next month"
            onClick={() => goToMonth(1)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.body}>
        <section className={styles.calendar} aria-label={`Subscriptions in ${monthLabel(monthKey)}`}>
          <div className={styles.weekdays} aria-hidden="true">
            {weekdayLabels.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>

          <div
            key={monthKey}
            className={styles.days}
            data-direction={direction}
            data-loading={loading ? "true" : undefined}
          >
            {Array.from({ length: grid.lead }, (_, index) => (
              <span key={`lead-${index}`} className={styles.dayFiller} aria-hidden="true" />
            ))}

            {grid.days.map((dateKey) => {
              const entries = month.entriesByDate[dateKey] ?? [];
              const dayNumber = Number(dateKey.slice(8, 10));

              return (
                <button
                  key={dateKey}
                  type="button"
                  className={styles.day}
                  data-selected={selectedDate === dateKey ? "true" : undefined}
                  data-today={today === dateKey ? "true" : undefined}
                  data-billing={entries.length ? "true" : undefined}
                  aria-pressed={selectedDate === dateKey}
                  aria-label={
                    entries.length
                      ? `${formatDayLabel(dateKey)}, ${copy.dayUnit(entries.length)}`
                      : formatDayLabel(dateKey)
                  }
                  onClick={() => setSelection({ monthKey, date: dateKey })}
                >
                  <span className={styles.dayNumber}>{dayNumber}</span>
                  <DayDots entries={entries} />
                </button>
              );
            })}
          </div>

          <div className={styles.legend}>
            <span><i data-cadence="monthly" />Monthly</span>
            <span><i data-cadence="annual" />Annual</span>
          </div>
        </section>

        <section
          className={styles.detail}
          aria-live="polite"
          aria-label="Selected day subscriptions"
        >
          <header className={styles.detailHead}>
            <span>{selectedDate ? formatDayLabel(selectedDate) : "Select a day"}</span>
            <strong>{copy.unit(selectedEntries.length)}</strong>
          </header>

          <div key={selectedDate ?? "none"} className={styles.detailList}>
            {loading ? (
              <p className={styles.empty}>{copy.loading}</p>
            ) : selectedEntries.length === 0 ? (
              <p className={styles.empty}>{copy.empty}</p>
            ) : (
              selectedEntries.map((entry) => (
                <EntryCard key={entry.key} entry={entry} perspective={perspective} />
              ))
            )}
          </div>
        </section>
      </div>

      <footer className={styles.summary}>
        <div className={styles.summaryPrimary}>
          <span>{copy.monthlyTotal}</span>
          <strong>
            {formatCurrencyCents(headline?.monthlyCents ?? 0, headline?.currency ?? "USD")}
          </strong>
          {extraTotals.length ? (
            <small>
              {extraTotals
                .map((total) => formatCurrencyCents(total.monthlyCents, total.currency))
                .join(" / ")}
            </small>
          ) : null}
        </div>

        <div className={styles.summaryStats}>
          <div>
            <span>{copy.annualTotal}</span>
            <strong>
              {formatCurrencyCents(headline?.annualCents ?? 0, headline?.currency ?? "USD")}
            </strong>
          </div>

          <div>
            <span>{copy.activeLabel}</span>
            <strong>{month.summary.activeCount}</strong>
          </div>

          {/*
            * Owner counts what started this month; a client counts what they
            * actually have to pay in the visible month, which is the entry
            * count the projection already produced.
            */}
          <div>
            <span>{copy.fourthLabel}</span>
            <strong>
              {isOwner ? month.summary.newThisMonthCount : month.summary.monthEntryCount}
            </strong>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function SubscriptionCalendarModal({
  perspective,
  loadSources,
  onClose,
}: {
  perspective: SubscriptionCalendarPerspective;
  loadSources: () => Promise<SubscriptionCalendarResult>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const [closing, setClosing] = useState(false);
  const [sources, setSources] = useState<SubscriptionCalendarSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestClose = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, closeAnimationMs);
  }, [onClose]);

  useEffect(() => {
    let active = true;

    void loadSources().then((result) => {
      if (!active) return;
      setSources(result.ok ? result.sources : []);
      setError(result.ok ? null : result.error);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [loadSources]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };

    window.addEventListener("keydown", onKeyDown);
    document.body.classList.add("wf-subscription-calendar-open");

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("wf-subscription-calendar-open");
    };
  }, [requestClose]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const overlay = (
    <div className={styles.overlay} data-closing={closing ? "true" : undefined} role="presentation">
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Close subscription calendar"
        onClick={requestClose}
      />

      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Subscription calendar"
        tabIndex={-1}
      >
        <button
          type="button"
          className={styles.close}
          aria-label="Close"
          onClick={requestClose}
        >
          <X size={17} aria-hidden="true" />
        </button>

        <SubscriptionCalendarPanel
          perspective={perspective}
          sources={sources}
          loading={loading}
          error={error}
        />
      </section>
    </div>
  );

  /*
   * The modal is only ever rendered from a click, so it never runs during SSR;
   * the guard keeps that contract explicit rather than relying on a mount flag.
   */
  if (typeof document === "undefined") return null;

  return createPortal(overlay, document.body);
}
