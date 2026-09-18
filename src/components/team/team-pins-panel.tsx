"use client";

import { Loader2, Pin, PinOff, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TeamMessagePinView } from "../../domain/team/projections";
import styles from "./team-messages.module.css";

/** Keeps the popover clear of the conversation container's edges while it tracks the trigger. */
const EDGE_MARGIN = 12;
const PANEL_WIDTH = 360;

export function TeamPinsPanel({ current, previous, canManage, onJump, onUnpin }: {
  current: TeamMessagePinView[];
  previous: TeamMessagePinView[];
  canManage: boolean;
  onJump: (messageId: string) => void;
  onUnpin: (pin: TeamMessagePinView) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState({ left: 0, caret: 20 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const container = trigger.closest<HTMLElement>('[data-team-region="message-thread"]');
    const bounds = container?.getBoundingClientRect();
    const boundsLeft = bounds?.left ?? EDGE_MARGIN;
    const boundsRight = bounds?.right ?? (typeof window !== "undefined" ? window.innerWidth - EDGE_MARGIN : boundsLeft + PANEL_WIDTH);
    const width = Math.min(PANEL_WIDTH, Math.max(0, boundsRight - boundsLeft - EDGE_MARGIN * 2));

    let left = 0;
    const overflowRight = triggerRect.left + width + EDGE_MARGIN - boundsRight;
    if (overflowRight > 0) left -= overflowRight;
    const overflowLeft = boundsLeft + EDGE_MARGIN - (triggerRect.left + left);
    if (overflowLeft > 0) left += overflowLeft;

    const caret = Math.min(Math.max(triggerRect.width / 2 - left, 20), Math.max(20, width - 20));
    setOffset({ left, caret });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    panelRef.current?.focus({ preventScroll: true });
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function key(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);

  function closeFromControl() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  async function unpin(pin: TeamMessagePinView) {
    setBusyId(pin.id); setError(null);
    const next = await onUnpin(pin);
    setBusyId(null);
    if (next) setError(next);
  }

  const empty = current.length === 0 && previous.length === 0;

  return (
    <div className={styles.pinsRoot} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.iconButton} ${open ? styles.iconButtonActive : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-label="Pinned messages"
        aria-expanded={open}
      >
        <Pin aria-hidden="true" />
        {current.length ? <span className={styles.pinCount}>{current.length}</span> : null}
      </button>
      {open ? (
        <div
          ref={panelRef}
          className={styles.pinsPanel}
          role="dialog"
          aria-label="Pinned messages"
          tabIndex={-1}
          style={{ "--pins-left": `${offset.left}px`, "--pins-caret": `${offset.caret}px` } as React.CSSProperties}
        >
          <div className={styles.pinsHeader}>
            <strong>Pinned</strong>
            <button type="button" onClick={closeFromControl} aria-label="Close pinned messages"><X aria-hidden="true" /></button>
          </div>
          <div className={styles.pinsBody}>
            {empty ? (
              <p className={styles.pinsEmpty}>No messages pinned yet.</p>
            ) : (
              <>
                <div className={styles.pinsSectionTitle}>Current</div>
                {current.length === 0 ? <p className={styles.pinsEmpty}>No messages are pinned.</p> : (
                  <div className={styles.pinList}>{current.map((pin) => (
                    <div className={styles.pinItem} key={pin.id}>
                      <button type="button" onClick={() => { onJump(pin.messageId); setOpen(false); }} disabled={pin.messageDeleted}>
                        <strong>{pin.messageDeleted ? "Message deleted" : pin.authorName}</strong>
                        <span>{pin.messageDeleted ? "This pinned message is no longer available." : pin.textPreview}</span>
                        <small>Pinned by {pin.pinnedByName} · {new Date(pin.pinnedAt).toLocaleString()}</small>
                      </button>
                      {canManage && !pin.messageDeleted ? <button type="button" onClick={() => void unpin(pin)} disabled={busyId === pin.id} aria-busy={busyId === pin.id || undefined} aria-label="Unpin message">{busyId === pin.id ? <Loader2 className={styles.spin} /> : <PinOff />}</button> : null}
                    </div>
                  ))}</div>
                )}
                <div className={styles.pinsSectionTitle}>Previous pins</div>
                {previous.length === 0 ? <p className={styles.pinsEmpty}>No previous pins.</p> : (
                  <div className={styles.pinList}>{previous.map((pin) => (
                    <button type="button" className={styles.pinHistoryItem} key={pin.id} onClick={() => { if (!pin.messageDeleted) onJump(pin.messageId); setOpen(false); }} disabled={pin.messageDeleted}>
                      <strong>{pin.messageDeleted ? "Message deleted" : pin.authorName}</strong>
                      <span>{pin.messageDeleted ? "No longer available" : pin.textPreview}</span>
                      <small>Unpinned {pin.unpinnedAt ? new Date(pin.unpinnedAt).toLocaleString() : ""}</small>
                    </button>
                  ))}</div>
                )}
              </>
            )}
          </div>
          {error ? <p className={styles.voiceError} role="alert">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
