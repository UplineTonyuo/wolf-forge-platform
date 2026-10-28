"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { updateOrderNoteAction } from "../../app/actions/orders";
import styles from "./order-team-note.module.css";

export function OrderTeamNote({ orderId, note, canEdit }: { orderId: string; note: string | null; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [saved, setSaved] = useState({ source: note, value: note });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const generation = useRef(0);
  const saving = useRef(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const inputId = useId();
  const currentNote = saved.source === note ? saved.value : note;

  useEffect(() => {
    generation.current += 1;
    return () => { generation.current += 1; };
  }, [orderId, canEdit]);

  useEffect(() => {
    if (!editing && restoreFocus.current) { editButton.current?.focus(); restoreFocus.current = false; }
  }, [editing]);

  function save() {
    if (saving.current || !canEdit) return;
    saving.current = true;
    const requestGeneration = generation.current;
    setError(null); setMessage("");
    startTransition(async () => {
      try {
        const result = await updateOrderNoteAction(orderId, draft);
        if (generation.current !== requestGeneration) return;
        if (!result.ok) { setError(result.error); return; }
        setSaved({ source: note, value: result.notes });
        restoreFocus.current = true;
        setEditing(false); setMessage("Note saved.");
      } catch {
        if (generation.current === requestGeneration) setError("The note could not be saved. Your text is still here. Try again.");
      } finally { saving.current = false; }
    });
  }

  return <section className={styles.note} aria-labelledby={`${inputId}-heading`}>
    <header><h2 id={`${inputId}-heading`}>Team note</h2>
      {canEdit ? <button ref={editButton} type="button" className="button-secondary" hidden={editing} onClick={() => {
        setDraft(currentNote ?? ""); setError(null); setMessage(""); setEditing(true);
      }}>{currentNote ? "Edit" : "Add a note"}</button> : null}
    </header>
    {editing && canEdit ? <form onSubmit={(event) => { event.preventDefault(); save(); }}>
      <label htmlFor={inputId}>Private note for your team</label>
      <textarea id={inputId} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={pending} autoFocus aria-describedby={error ? `${inputId}-error` : undefined} />
      {error ? <p id={`${inputId}-error`} role="alert">{error}</p> : null}
      <footer>
        <button type="button" className="button-secondary" disabled={pending} onClick={() => {
          restoreFocus.current = true;
          setDraft(currentNote ?? ""); setError(null); setEditing(false);
        }}>Cancel</button>
        <button type="submit" className="button-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save"}</button>
      </footer>
    </form> : <p>{currentNote || "Add a note for your team…"}</p>}
    <span role="status">{pending ? "Saving note…" : canEdit ? message : ""}</span>
  </section>;
}
