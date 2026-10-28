"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { Json } from "../../lib/supabase/database.types";
import { MAX_SIGNATURE_POINTS, MAX_SIGNATURE_STROKES, readSignatureStrokes, type SignatureStrokes } from "../../lib/forms/signature";
import styles from "./drawn-signature.module.css";

export function SignatureDrawing({ strokes, label }: { strokes: SignatureStrokes; label: string }) {
  return <svg className={styles.image} viewBox="0 0 1000 400" preserveAspectRatio="none" role="img" aria-label={label}>
    {strokes.map((stroke, index) => <polyline key={index} points={stroke.map((point) => point.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
  </svg>;
}

export function DrawnSignature({ id, label, value, required, disabled, onChange }: {
  id: string; label: string; value: Json | undefined; required: boolean; disabled: boolean; onChange: (value: Json) => void;
}) {
  const signature = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const name = typeof signature.name === "string" ? signature.name : "";
  const strokes = readSignatureStrokes(signature.drawing) ?? [];
  const active = useRef<{ pointer: number; stroke: [number, number][] } | null>(null);
  const [liveStroke, setLiveStroke] = useState<[number, number][]>([]);
  const [limitMessage, setLimitMessage] = useState("");

  function point(event: PointerEvent<SVGSVGElement>): [number, number] {
    const bounds = event.currentTarget.getBoundingClientRect();
    return [Math.round(Math.max(0, Math.min(1000, (event.clientX - bounds.left) / bounds.width * 1000))),
      Math.round(Math.max(0, Math.min(400, (event.clientY - bounds.top) / bounds.height * 400)))];
  }

  function finish(event: PointerEvent<SVGSVGElement>, cancelled = false) {
    const current = active.current;
    if (!current || current.pointer !== event.pointerId) return;
    active.current = null;
    setLiveStroke([]);
    if (!disabled && !cancelled && current.stroke.length >= 2) {
      onChange({ name, consent: false, drawing: [...strokes, current.stroke] });
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div className={styles.control}>
    <label htmlFor={id}>Full name<input id={id} value={name} maxLength={200} autoComplete="name" required={required || strokes.length > 0} disabled={disabled}
      onChange={(event) => onChange({ name: event.target.value, consent: false, drawing: strokes })} /></label>
    <p id={`${id}-instructions`}>Draw your signature below with your finger, mouse or pen. If you cannot draw, contact the team for help signing.</p>
    <svg className={styles.pad} viewBox="0 0 1000 400" preserveAspectRatio="none" role="img" aria-label={`${label} drawing area`} aria-describedby={`${id}-instructions`} data-disabled={disabled}
      onPointerDown={(event) => {
        if (disabled || active.current || event.button !== 0) return;
        if (strokes.length >= MAX_SIGNATURE_STROKES || strokes.flat().length >= MAX_SIGNATURE_POINTS) {
          setLimitMessage("The signature area is full. Clear it and sign again."); return;
        }
        const first = point(event);
        if (!Number.isFinite(first[0]) || !Number.isFinite(first[1])) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        active.current = { pointer: event.pointerId, stroke: [first] };
        setLiveStroke([first]);
        if (signature.consent === true) onChange({ name, consent: false, drawing: strokes });
      }}
      onPointerMove={(event) => {
        const current = active.current;
        if (disabled || !current || current.pointer !== event.pointerId) return;
        if (strokes.flat().length + current.stroke.length >= MAX_SIGNATURE_POINTS) {
          setLimitMessage("The signature area is full. Finish this stroke or clear it and sign again."); return;
        }
        const next = point(event), last = current.stroke.at(-1)!;
        if (!Number.isFinite(next[0]) || !Number.isFinite(next[1]) || Math.hypot(next[0] - last[0], next[1] - last[1]) < 2) return;
        current.stroke.push(next);
        setLiveStroke([...current.stroke]);
      }}
      onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} onLostPointerCapture={(event) => finish(event, true)}>
      {[...strokes, ...(liveStroke.length ? [liveStroke] : [])].map((stroke, index) => <polyline key={index} points={stroke.map((coordinates) => coordinates.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
      {!strokes.length && !liveStroke.length ? <text x="500" y="220" textAnchor="middle" aria-hidden="true">Sign here</text> : null}
    </svg>
    <div className={styles.actions}><button type="button" className="button-secondary" disabled={disabled || (!strokes.length && !liveStroke.length)} onClick={() => {
      active.current = null; setLiveStroke([]); setLimitMessage(""); onChange({ name, consent: false, drawing: [] });
    }}>Clear signature</button><span role="status">{limitMessage || (strokes.length ? "Signature captured. Confirm your consent below." : "No signature drawn yet.")}</span></div>
    <label className={styles.consent}><input type="checkbox" checked={signature.consent === true} required={required || strokes.length > 0 || Boolean(name.trim())}
      disabled={disabled || !name.trim() || !strokes.length} onChange={(event) => onChange({ name, drawing: strokes, consent: event.target.checked })} />
      <span>I agree to use this drawn signature as my electronic signature for this form.</span></label>
  </div>;
}
