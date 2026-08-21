"use client";

import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  MessageSquare,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ReportSlide, ReportSlideEntry } from "../../../domain/reporting/slideshow";
import styles from "./client-report-slideshow.module.css";

/**
 * Client report slideshow — the distraction-free presentation mode.
 *
 * When a client opens a report, the full document stays mounted behind this
 * overlay (so the existing read receipt and the full-report route keep working)
 * while the deck plays one slide at a time. The overlay is portalled to
 * document.body on purpose (see D-055: any `position: fixed` overlay rendered
 * inline inside a portal page resolves against the page's animated article box,
 * not the viewport). The shared centred-dialog rules — focus trap, focus
 * return, scroll lock, Escape, exit animation, reduced motion — are replayed
 * here because a full-screen story deck is not the small centred dialog
 * PortalDialog was built to be.
 */

/**
 * Must match the .panel exit duration in client-report-slideshow.module.css so
 * the closing frame plays to completion before the node unmounts.
 */
const exitMs = 190;

/** Keeps the current slide index inside [0, count). */
const clampIndex = (value: number, count: number) =>
  count === 0 ? 0 : Math.min(Math.max(value, 0), count - 1);

export function ClientReportSlideshow({
  slides,
  children,
}: {
  slides: ReportSlide[];
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [index, setIndex] = useState(0);

  const slideCount = slides.length;

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
   * The deck is the point of opening the report, so it opens on its own: the
   * overlay is live whenever this component is mounted on the client and the
   * client has not dismissed it. Deriving `open` from `mounted` here — rather
   * than turning it on in an effect — paints the first client frame already
   * open, so the entrance is one render, not a cascade.
   */
  const open = mounted && !dismissed;

  /*
   * Keep the panel mounted while its exit animation runs. Flipped during render
   * using the documented "adjust state when a value changes" pattern, so the
   * closing frame paints in the same pass the state changed — an effect would
   * show one frame with the overlay already gone.
   */
  const [lastOpen, setLastOpen] = useState(false);
  if (lastOpen !== open) {
    setLastOpen(open);
    setExiting(!open);
  }

  const close = useCallback(() => {
    setDismissed(true);
  }, []);

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => setExiting(false), exitMs);
    return () => clearTimeout(timer);
  }, [exiting]);

  const render = open || exiting;
  const phase = open ? "open" : "closing";

  /* Focus the panel on open; hand focus back to wherever it was before. */
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, [open]);

  const focusables = useCallback(
    () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ),
    [],
  );

  /* Scroll lock, Escape/arrows and the Tab trap while the overlay is live. */
  useEffect(() => {
    if (!render) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const target = event.target as HTMLElement | null;
        const typing =
          target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          target?.isContentEditable;
        if (typing) return;
        event.preventDefault();
        setIndex((current) =>
          event.key === "ArrowLeft"
            ? clampIndex(current - 1, slideCount)
            : clampIndex(current + 1, slideCount),
        );
        return;
      }

      if (event.key !== "Tab") return;

      // Keep Tab inside the deck: an overlay the keyboard can walk out of is
      // not modal to anyone using one.
      const nodes = focusables();
      if (nodes.length === 0) return;

      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement;
      const panel = panelRef.current;
      const outside = !panel?.contains(active);

      // The panel itself takes focus on open and is not in the tab order, so
      // a Tab from it must resolve inside the deck rather than walking out.
      const onPanel = active === panel;

      if (event.shiftKey && (active === first || outside || onPanel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside || onPanel)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [render, close, focusables, slideCount]);

  const progress = slideCount === 0 ? 0 : ((index + 1) / slideCount) * 100;
  const slide = slides[index];
  const isFirst = index === 0;
  const isLast = index === slideCount - 1;

  return (
    <>
      {children}

      {mounted && render ? (
        createPortal(
          <div className={styles.overlay} data-phase={phase}>
            <button
              type="button"
              className={styles.backdrop}
              aria-label="Close report"
              data-testid="report-backdrop"
              tabIndex={-1}
              onClick={close}
            />

            <div
              ref={panelRef}
              className={styles.panel}
              role="dialog"
              aria-modal="true"
              aria-label="Report slideshow"
              tabIndex={-1}
            >
              <div className={styles.progressTrack} aria-hidden="true">
                <div
                  className={styles.progressBar}
                  data-testid="report-progress-bar"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className={styles.slideArea}>
                <div key={index} className={styles.slideShell}>
                  {slide ? renderSlide(slide, close) : null}
                </div>
                <div className={styles.srOnly} role="status">
                  {slide?.title}
                </div>
              </div>

              <div className={styles.controls}>
                <button
                  type="button"
                  className={styles.navButton}
                  onClick={() => setIndex((current) => clampIndex(current - 1, slideCount))}
                  disabled={isFirst}
                >
                  <ArrowLeft aria-hidden="true" />
                  Back
                </button>

                <span className={styles.controlsSpacer} />

                <button
                  type="button"
                  className={styles.closeButton}
                  onClick={close}
                  aria-label="Close report"
                >
                  <X aria-hidden="true" />
                </button>

                {!isLast ? (
                  <button
                    type="button"
                    className={styles.nextButton}
                    onClick={() => setIndex((current) => clampIndex(current + 1, slideCount))}
                  >
                    Next
                    <ArrowRight aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
          </div>,
          document.body,
        )
      ) : null}
    </>
  );
}

function renderSlide(slide: ReportSlide, onClose: () => void): ReactNode {
  if (slide.kind === "cover") {
    return (
      <section className={styles.coverSlide} aria-label="Cover slide">
        <p className={styles.eyebrow}>Wolf Forge · Monthly Report</p>
        <h2 className={styles.coverTitle}>{slide.title}</h2>
        <p className={styles.coverCompany}>Prepared for {slide.cover?.companyName}</p>
        <p className={styles.coverMeta}>
          {slide.cover?.packageLabel}
          {slide.cover?.laneLabel ? <> · {slide.cover.laneLabel}</> : null}
          {slide.cover?.sentLabel ? <> · {slide.cover.sentLabel}</> : null}
        </p>
      </section>
    );
  }

  if (slide.kind === "closing") {
    return (
      <section className={styles.closingSlide} aria-label="Closing slide">
        <p className={styles.eyebrow}>Wolf Forge</p>
        <h2 className={styles.slideTitle}>{slide.title}</h2>
        {slide.subtitle ? <p className={styles.closingMessage}>{slide.subtitle}</p> : null}
        <div className={styles.closingActions}>
          <button type="button" className={styles.primaryAction} onClick={onClose}>
            View full report
          </button>
          <Link
            className={styles.secondaryAction}
            href="/account/messages?compose=1"
          >
            <MessageSquare aria-hidden="true" />
            Message Wolf Forge
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.contentSlide} data-kind={slide.kind} aria-label={slide.title}>
      {slide.kind === "one_time" ? <p className={styles.eyebrow}>One-time setup</p> : null}
      <h2 className={styles.slideTitle}>{slide.title}</h2>
      {slide.oneTimeCompleted ? (
        <p className={styles.completedMark}>Completed this cycle</p>
      ) : null}
      {renderEntries(slide.entries)}
    </section>
  );
}

function renderEntries(entries: ReportSlideEntry[]): ReactNode {
  if (entries.length === 0) {
    return <p className={styles.empty}>No updates were included in this section.</p>;
  }

  const pairs = new Map<string, ReportSlideEntry[]>();
  const singles: ReportSlideEntry[] = [];
  for (const entry of entries) {
    if (entry.pairKey) {
      const group = pairs.get(entry.pairKey) ?? [];
      group.push(entry);
      pairs.set(entry.pairKey, group);
    } else {
      singles.push(entry);
    }
  }

  return (
    <dl className={styles.entries}>
      {Array.from(pairs.values()).map((group) => renderPair(group))}
      {singles.map((entry, index) => (
        <div className={styles.entry} key={`${entry.label}-${index}`}>
          <dt>{entry.label}</dt>
          <dd>
            {entry.value ? <p>{entry.value}</p> : null}
            {entry.url ? (
              <a
                className={styles.asset}
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`View asset for ${entry.label}. Opens in a new tab.`}
              >
                View asset
                <ExternalLink aria-hidden="true" />
              </a>
            ) : null}
            {!entry.value && !entry.url ? (
              <span className={styles.noDetail}>No detail included</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function renderPair(group: ReportSlideEntry[]): ReactNode {
  const before = group.find((entry) => entry.pairRole === "before");
  const after = group.find((entry) => entry.pairRole === "after");
  const base = before?.pairBase ?? after?.pairBase ?? "";

  return (
    <div className={styles.transform} key={base}>
      <p className={styles.transformLabel}>{base}</p>
      <div className={styles.transformRow}>
        <div className={styles.transformHalf}>
          <em>Before</em>
          {before?.value ? <strong>{before.value}</strong> : null}
          {before?.url ? (
            <a
              className={styles.transformAsset}
              href={before.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              View asset
              <ExternalLink aria-hidden="true" />
            </a>
          ) : null}
          {!before?.value && !before?.url ? (
            <span className={styles.transformEmpty}>No detail</span>
          ) : null}
        </div>

        <ArrowRight className={styles.transformArrow} aria-hidden="true" />

        <div className={styles.transformHalf} data-role="after">
          <em>After</em>
          {after?.value ? <strong>{after.value}</strong> : null}
          {after?.url ? (
            <a
              className={styles.transformAsset}
              href={after.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              View asset
              <ExternalLink aria-hidden="true" />
            </a>
          ) : null}
          {!after?.value && !after?.url ? (
            <span className={styles.transformEmpty}>No detail</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
