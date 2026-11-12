"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, Maximize2, Mic, MicOff, PhoneOff } from "lucide-react";
import styles from "./calls.module.css";

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type Point = { x: number; y: number };
type Bounds = { left: number; top: number; right: number; bottom: number };
const gap = 12;
const obstacleSelector = [
 'form[data-target-kind]', '[data-call-avoid]', 'nav[aria-label="Mobile bottom navigation"]',
 '.app-sidebar', '.portal-sidebar', '.workspace-command-bar', '.portal-command-bar',
 '.portal-command-trailing', '.page-actions', 'aside[aria-label="Order details"]', `.${styles.audioPrompt}`,
].join(",");

// Candidate edges keep the window near its corner without covering working controls.
export function placeCallWindow(corner: Corner, width: number, height: number, viewport: Bounds, obstacles: Bounds[], preferred?: Point): (Point & { height: number }) | null {
 const minX = viewport.left + gap, minY = viewport.top + gap, bottom = viewport.bottom - gap;
 const maxX = Math.max(minX, viewport.right - width - gap);
 const clampX = (x: number) => Math.max(minX, Math.min(maxX, x));
 const idealX = preferred ? clampX(preferred.x) : corner.endsWith("right") ? maxX : minX;
 const xs = [idealX, minX, maxX, ...obstacles.flatMap(r => [clampX(r.right + gap), clampX(r.left - width - gap)])];
 let best: (Point & { height: number }) | null = null, distance = Infinity;
 for (const x of xs) {
  const blocked = obstacles.filter(r => x < r.right + gap && x + width > r.left - gap).sort((a, b) => a.top - b.top);
  let top = minY;
  const consider = (end: number) => {
   const available = Math.min(height, end - top);
   if (available < Math.min(44, height)) return;
   const idealY = preferred?.y ?? (corner.startsWith("bottom") ? bottom - available : minY);
   const y = Math.max(top, Math.min(end - available, idealY));
   const d = (x - idealX) ** 2 + (y - idealY) ** 2;
   if (!best || available > best.height || available === best.height && d < distance) { best = { x, y, height: available }; distance = d; }
  };
  for (const rect of blocked) { consider(Math.min(bottom, rect.top - gap));top = Math.max(top, rect.bottom + gap); }
  consider(bottom);
 }
 return best;
}

function viewportBounds(): Bounds {
 const view = window.visualViewport;
 const left = view?.offsetLeft ?? 0, top = view?.offsetTop ?? 0;
 return { left, top, right: left + (view?.width ?? window.innerWidth), bottom: top + (view?.height ?? window.innerHeight) };
}

function workingControls(node: HTMLElement): HTMLElement[] {
 return Array.from(document.body.querySelectorAll<HTMLElement>(obstacleSelector))
  .filter(element => !node.contains(element) && !element.contains(node));
}
function controlBounds(elements: HTMLElement[]): Bounds[] {
 return elements.filter(element => {
  if (element.closest('[role="dialog"], dialog, .portal-overlay, [aria-hidden="true"], [hidden], [inert]')) return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.pointerEvents === "none") return false;
  if (element.checkVisibility && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  return element.matches('form[data-target-kind], [data-call-avoid]') || style.position === "fixed" || style.position === "sticky";
 }).map(element => element.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight);
}

export function FloatingCallWindow({ visible, name, clock, micOn, busy, onMute, onEnd, onExpand, children }: {
 visible: boolean; name: string; clock: string; micOn: boolean; busy: boolean;
 onMute: () => void; onEnd: () => void; onExpand: () => void; children: ReactNode;
}) {
 const [corner, setCorner] = useState<Corner>("bottom-right");
 const cornerRef = useRef<Corner>("bottom-right");
 const [point, setPoint] = useState<(Point & { height: number }) | null>(null);
 const [unplaceable, setUnplaceable] = useState(false);
 const controls = useRef<HTMLElement[]>([]);
 const suppressClick = useRef(false);
 const [dragging, setDragging] = useState(false);
 const frame = useRef<HTMLDivElement>(null);
 const drag = useRef<{ id: number; x: number; y: number; start: Point; moved: boolean } | null>(null);
 const settle = useRef(() => {});

 useLayoutEffect(() => {
  const node = frame.current;
  if (!visible || !node) return;
  let scheduled = 0, refreshControls = true;
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule());
  const measure = () => {
   scheduled = 0;
   if (refreshControls) {
    refreshControls = false;controls.current = workingControls(node);
    resize?.disconnect();resize?.observe(document.body);resize?.observe(node);
    controls.current.forEach(element => resize?.observe(element));
   }
   if (drag.current) return;
   // Measure the natural frame even after a compact layout, so it can grow again.
   const view = viewportBounds();
   node.style.maxWidth = Math.max(44, view.right - view.left - gap * 2) + "px";
   const width = node.getBoundingClientRect().width;
   const naturalHeight = 44 + width * 9 / 16 + 60;
   const next = placeCallWindow(cornerRef.current, width, naturalHeight, view, controlBounds(controls.current));
   setUnplaceable(!next);
   setPoint(previous => previous?.x === next?.x && previous?.y === next?.y && previous?.height === next?.height ? previous : next);
  };
  const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(measure); };
  const refresh = () => { refreshControls = true;schedule(); };
  const viewportResize = () => { drag.current = null;setDragging(false);refresh(); };
  settle.current = measure;
  measure();
  const observer = new MutationObserver(records => {
   if (records.some(record => !node.contains(record.target) && [...record.addedNodes, ...record.removedNodes].some(changed => changed.nodeType === Node.ELEMENT_NODE))) refresh();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", viewportResize);window.addEventListener("scroll", schedule, true);
  window.visualViewport?.addEventListener("resize", viewportResize);window.visualViewport?.addEventListener("scroll", schedule);
  return () => {
   observer.disconnect();resize?.disconnect();cancelAnimationFrame(scheduled);drag.current = null;
   window.removeEventListener("resize", viewportResize);window.removeEventListener("scroll", schedule, true);
   window.visualViewport?.removeEventListener("resize", viewportResize);window.visualViewport?.removeEventListener("scroll", schedule);
  };
 }, [visible]);

 useLayoutEffect(() => { cornerRef.current = corner;settle.current(); }, [corner]);

 if (!visible || typeof document === "undefined") return null;
 const finish = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
  const active = drag.current;if (!active || active.id !== event.pointerId) return;
  drag.current = null;suppressClick.current = active.moved;setDragging(false);
  if (!cancelled && active.moved && frame.current) {
   const rect = frame.current.getBoundingClientRect(), view = viewportBounds();
   const horizontal = rect.left + rect.width / 2 < (view.left + view.right) / 2 ? "left" : "right";
   const vertical = rect.top + rect.height / 2 < (view.top + view.bottom) / 2 ? "top" : "bottom";
   setCorner(vertical + "-" + horizontal as Corner);
  }
  settle.current();
 };
 const style = point ? { left: point.x, top: point.y, height: point.height } : undefined;
 return createPortal(<div ref={frame} role="region" aria-label="Floating video call" className={styles.floating} data-corner={corner} data-compact={point && point.height < 152 || undefined} data-unplaceable={unplaceable || undefined} data-dragging={dragging || undefined} style={style as CSSProperties}>
  <button type="button" className={styles.floatingMove} aria-label="Move call window. Tap for next corner or use arrow keys" title="Drag or tap to move" onClick={() => {
   if (suppressClick.current) { suppressClick.current = false;return; }
   const corners: Corner[] = ["bottom-right", "bottom-left", "top-left", "top-right"];
   setCorner(current => corners[(corners.indexOf(current) + 1) % corners.length]!);
  }} onKeyDown={event => {
   if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
   event.preventDefault();
   setCorner(current => ((event.key === "ArrowUp" ? "top" : event.key === "ArrowDown" ? "bottom" : current.split("-")[0]) + "-" + (event.key === "ArrowLeft" ? "left" : event.key === "ArrowRight" ? "right" : current.split("-")[1])) as Corner);
  }} onPointerDown={event => {
   if (!event.isPrimary || event.button !== 0 || !frame.current) return;
   const rect = frame.current.getBoundingClientRect();
   drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: { x: rect.left, y: rect.top }, moved: false };
   event.currentTarget.setPointerCapture(event.pointerId);setDragging(true);
  }} onPointerMove={event => {
   const active = drag.current, node = frame.current;if (!active || active.id !== event.pointerId || !node) return;
   const view = viewportBounds(), rect = node.getBoundingClientRect();
   if (Math.hypot(event.clientX - active.x, event.clientY - active.y) > 5) active.moved = true;
   const next = placeCallWindow(corner, rect.width, rect.height, view, controlBounds(controls.current), { x: active.start.x + event.clientX - active.x, y: active.start.y + event.clientY - active.y });
   if (next) setPoint(next);
  }} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}>
   <span>{name}</span><strong>{clock}</strong><GripHorizontal aria-hidden="true"/>
  </button>
  <button type="button" className={styles.floatingStage} aria-label={"View full video call with " + name} onClick={onExpand}>{children}</button>
  <div className={styles.controls + " " + styles.floatingControls}>
   <button type="button" aria-label={micOn ? "Mute microphone" : "Unmute microphone"} aria-pressed={!micOn} onClick={onMute}>{micOn ? <Mic aria-hidden="true"/> : <MicOff aria-hidden="true"/>}</button>
   <button type="button" className={styles.end} aria-label="End call" disabled={busy} onClick={onEnd}><PhoneOff aria-hidden="true"/></button>
   <button type="button" aria-label={"Reopen call with " + name} onClick={onExpand}><Maximize2 aria-hidden="true"/></button>
  </div>
 </div>, document.body);
}
