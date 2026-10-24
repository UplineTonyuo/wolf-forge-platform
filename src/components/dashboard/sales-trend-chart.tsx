"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useRef, useState, useTransition, type KeyboardEvent, type PointerEvent } from "react";
import { shiftRevenueWindow, type RevenueWindow } from "../../lib/dashboard/chart-window";
import { revenuePlot, revenueTickIndexes } from "../../lib/dashboard/revenue-plot";
import styles from "./sales-trend-chart.module.css";

export type SalesTrendPoint = {
  value: number;
  label: string;
  axisLabel: string;
  money: string;
};

export function SalesTrendChart({ points, currency, window: dateWindow }: {
  points: SalesTrendPoint[]; currency: string; window?: RevenueWindow;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const gradient = `revenue-${useId()}`;
  const [active, setActive] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const dragStart = useRef<{ x: number; y: number; width: number } | null>(null);
  const plot = revenuePlot(points.map((point) => point.value));
  const canEarlier = Boolean(dateWindow && shiftRevenueWindow(dateWindow, -1));
  const canLater = Boolean(dateWindow && shiftRevenueWindow(dateWindow, 1));
  const peak = points.reduce((best, point, index) =>
    Math.abs(point.value) > Math.abs(points[best]?.value ?? 0) ? index : best, 0);
  const selected = active ?? peak;
  const point = points[selected];
  const coordinate = plot.points[selected];
  const axisMoney = new Intl.NumberFormat("en", {
    style: "currency", currency, notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 2,
  });

  function trackPointer(event: PointerEvent<HTMLDivElement>) {
    if (dragStart.current) {
      const dx = event.clientX - dragStart.current.x;
      const dy = event.clientY - dragStart.current.y;
      if (Math.abs(dx) > Math.abs(dy)) setDragOffset(dx / dragStart.current.width * 100);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    setActive(Math.round(ratio * (points.length - 1)));
  }

  function moveWindow(direction: -1 | 1) {
    if (!dateWindow || pending) return;
    const next = shiftRevenueWindow(dateWindow, direction);
    if (!next) return;
    const query = new URLSearchParams(searchParams.toString());
    query.delete("date");
    query.set("period", "custom_range");
    query.set("from", next.from);
    query.set("to", next.to);
    startTransition(() => router.push(`/dashboard?${query}`, { scroll: false }));
  }

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dateWindow || pending || (!canEarlier && !canLater) || event.button !== 0) return;
    dragStart.current = { x: event.clientX, y: event.clientY, width: Math.max(1, event.currentTarget.getBoundingClientRect().width) };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function cancelDrag() { dragStart.current = null; setDragOffset(0); }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    cancelDrag();
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= Math.min(64, start.width * .18) && Math.abs(dx) > Math.abs(dy)) {
      moveWindow(dx > 0 ? -1 : 1);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const pointerHandlers = {
    onPointerDown: beginDrag, onPointerMove: trackPointer, onPointerUp: endDrag,
    onPointerCancel: cancelDrag, onLostPointerCapture: cancelDrag,
    onPointerLeave: () => { if (!dragStart.current) setActive(null); },
  };

  function browse(event: KeyboardEvent<HTMLDivElement>) {
    if (dateWindow && (event.key === "PageUp" || event.key === "PageDown")) {
      event.preventDefault();
      moveWindow(event.key === "PageUp" ? -1 : 1);
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    setActive(event.key === "Home" ? 0 : event.key === "End" ? points.length - 1
      : Math.max(0, Math.min(points.length - 1, selected + (event.key === "ArrowLeft" ? -1 : 1))));
  }

  return (
    <figure className={styles.figure} aria-busy={pending}>
      {dateWindow ? <div className={styles.history}>
        <span>{canEarlier ? "Drag right for earlier dates" : canLater
          ? "Start of revenue history · drag left for newer dates" : "All available revenue history is shown"}</span>
        <div><button type="button" aria-label="Earlier dates" disabled={pending || !canEarlier}
          onClick={() => moveWindow(-1)}><ChevronLeft size={16} aria-hidden="true" /></button>
          <button type="button" aria-label="Later dates" disabled={pending || !canLater}
            onClick={() => moveWindow(1)}><ChevronRight size={16} aria-hidden="true" /></button></div>
        <span className={styles.historyStatus} role="status">{pending ? "Loading dates…" : ""}</span>
      </div> : null}
      <div className={styles.chart}>
        <div className={styles.yAxis} aria-hidden="true">
          {plot.ticks.map((tick) => <span key={tick.value} style={{ top: `${tick.y}%` }}>{axisMoney.format(tick.value / 100)}</span>)}
        </div>
        <div className={styles.plot} role="group" tabIndex={0}
          aria-label="Net revenue chart. Use Left and Right arrow keys to inspect dates, Page Up and Page Down to browse history."
          onKeyDown={browse} onFocus={() => setActive(peak)} onBlur={() => setActive(null)}
          data-pannable={canEarlier || canLater} data-dragging={dragOffset !== 0} {...pointerHandlers}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5574a7" stopOpacity=".25" />
              <stop offset="100%" stopColor="#5574a7" stopOpacity=".025" />
            </linearGradient></defs>
            {plot.ticks.map((tick) => <line className={styles.gridLine} key={tick.value} x1="0" x2="100" y1={tick.y} y2={tick.y} />)}
            <line className={styles.zeroLine} x1="0" x2="100" y1={plot.zeroY} y2={plot.zeroY} />
            <g transform={`translate(${dragOffset},0)`}>
              <path d={plot.area} fill={`url(#${gradient})`} />
              <path className={styles.revenueLine} d={plot.line} />
            </g>
          </svg>
          {coordinate && point && !dragOffset ? <>
            <span className={styles.cursor} style={{ left: `${coordinate.x}%` }} aria-hidden="true" />
            <span className={styles.dot} style={{ left: `${coordinate.x}%`, top: `${coordinate.y}%` }} aria-hidden="true" />
            <output className={styles.tooltip} aria-live="polite" style={{
              left: `clamp(70px, ${coordinate.x}%, calc(100% - 70px))`,
              top: `${coordinate.y}%`,
            }} data-below={coordinate.y < 25 || undefined}>
              <span>{point.label}</span><strong>{point.money}</strong>
            </output>
          </> : null}
        </div>
        <div className={styles.xAxis} aria-hidden="true">
          {revenueTickIndexes(points.length).map((index, tick) => {
            const entry = points[index];
            const position = plot.points[index];
            return entry && position ? <span key={index}
              style={{ left: `${position.x}%` }} data-tick={tick}>{entry.axisLabel}</span> : null;
          })}
        </div>
      </div>
      <details className={styles.data}><summary>View revenue data</summary>
        <div className={styles.tableWrap}><table><caption>Net collected revenue in {currency}</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Net revenue</th></tr></thead>
          <tbody>{points.map((entry, index) => <tr key={index}><th scope="row">{entry.label}</th><td>{entry.money}</td></tr>)}</tbody>
        </table></div>
      </details>
    </figure>
  );
}
