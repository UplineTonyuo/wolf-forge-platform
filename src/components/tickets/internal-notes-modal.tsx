"use client";

import { MoreHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { unsendTicketInternalNoteAction } from "../../app/actions/tickets";
import type { TicketDetailMessage } from "../../domain/tickets/schema";
import { formatDateTime } from "../../lib/format";
import { ticketActorLabel } from "../../lib/tickets/presentation";
import { TicketComposer } from "./ticket-composer";
import { chronologicalMessages } from "./ticket-conversation";
import { TicketMessageAvatar } from "./ticket-message-avatar";
import styles from "./tickets.module.css";

type ComposerTarget =
  | { kind: "ticket"; ticketId: string }
  | { kind: "order"; orderId: string };

const CLOSE_ANIMATION_MS = 150;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function InternalNoteActions({ messageId }: { messageId: string }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<"menu" | "confirm" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setView(null);
    setError(null);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!view) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, view]);

  useEffect(() => {
    if (view === "menu") menuButtonRef.current?.focus();
    if (view === "confirm") cancelRef.current?.focus();
  }, [view]);

  async function unsend() {
    if (pending) return;
    setPending(true);
    setError(null);
    let result;
    try {
      result = await unsendTicketInternalNoteAction(messageId);
    } catch {
      setError("Could not confirm unsending. Please try again.");
      setPending(false);
      return;
    }
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    setView(null);
    setPending(false);
    router.refresh();
  }

  return (
    <div ref={rootRef} className={styles.internalNoteActions}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.internalNoteActionsTrigger}
        aria-label="Note actions"
        aria-haspopup="menu"
        aria-expanded={view !== null}
        onClick={() => setView((current) => current ? null : "menu")}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>

      {view === "menu" ? (
        <div className={styles.internalNoteMenu} role="menu">
          <button ref={menuButtonRef} type="button" role="menuitem" onClick={() => setView("confirm")}>
            Unsend note
          </button>
        </div>
      ) : null}

      {view === "confirm" ? (
        <div className={styles.internalNoteConfirmation} role="alertdialog" aria-label="Unsend this note?">
          <strong>Unsend this note?</strong>
          <p>The note content will be hidden, but the note will remain in the activity history.</p>
          {error ? <p className={styles.actionError}>{error}</p> : null}
          <div>
            <button ref={cancelRef} type="button" onClick={close} disabled={pending}>Cancel</button>
            <button type="button" onClick={unsend} disabled={pending}>Unsend</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Internal notes live outside the client/staff conversation entirely
 * (Option A): a header control opens a centered modal holding every note plus
 * a composer, reusing the exact same note-add action the old inline composer
 * used. Nothing here is client-reachable — callers only render this for
 * profiles that already hold the internalNotes capability.
 */
export function InternalNotesModal({
  target,
  notes,
  disabled,
}: {
  target: ComposerTarget;
  notes: TicketDetailMessage[];
  disabled: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);

  const orderedNotes = chronologicalMessages(notes);

  function openModal() {
    setClosing(false);
    dialogRef.current?.showModal();
  }

  function requestClose() {
    setClosing(true);
    window.setTimeout(
      () => dialogRef.current?.close(),
      prefersReducedMotion() ? 0 : CLOSE_ANIMATION_MS,
    );
  }

  return (
    <>
      <button type="button" className={styles.internalNotesButton} onClick={openModal}>
        View note for this project
      </button>

      <dialog
        ref={dialogRef}
        className={styles.internalNotesDialog}
        aria-labelledby="internal-notes-modal-title"
        data-closing={closing ? "true" : undefined}
        onCancel={(event) => {
          event.preventDefault();
          requestClose();
        }}
        onClose={() => setClosing(false)}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled)");
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) requestClose();
        }}
      >
        <div className={styles.internalNotesLayout}>
          <header>
            <h2 id="internal-notes-modal-title">Internal notes</h2>
            <button type="button" aria-label="Close" onClick={requestClose}>
              <X aria-hidden="true" />
            </button>
          </header>

          <div className={styles.internalNotesList}>
            {orderedNotes.length === 0 ? (
              <p className={styles.internalNotesEmpty}>No internal notes yet.</p>
            ) : (
              orderedNotes.map((note) => (
                <article key={note.id} className={styles.internalNoteItem}>
                  <div className={styles.internalNoteMeta}>
                    <TicketMessageAvatar src={note.author_avatar_url} />
                    <div className={styles.internalNoteIdentity}>
                      <strong>{ticketActorLabel(note.author_type, note.author_name)}</strong>
                      <time dateTime={note.created_at}>{formatDateTime(note.created_at)}</time>
                    </div>
                    {note.can_unsend && !note.unsent_at ? <InternalNoteActions messageId={note.id} /> : null}
                  </div>

                  <p className={styles.internalNoteBody} data-unsent={note.unsent_at ? "true" : undefined}>
                    {note.unsent_at ? "This note was unsent." : note.body}
                  </p>
                </article>
              ))
            )}
          </div>

          <div className={styles.internalNotesComposerWrap}>
            <TicketComposer target={target} mode="note" disabled={disabled} hideSubmitIcon />
          </div>
        </div>
      </dialog>
    </>
  );
}
