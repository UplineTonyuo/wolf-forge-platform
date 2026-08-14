"use client";

import { LoaderCircle, LockKeyhole, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addTicketInternalNoteAction, adminReplyTicketAction, clientReplyTicketAction } from "../../app/actions/tickets";
import styles from "./tickets.module.css";

export function TicketComposer({ ticketId, mode, disabled = false }: { ticketId: string; mode: "admin" | "client" | "note"; disabled?: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isNote = mode === "note";
  const label = isNote ? "Internal note" : "Reply";

  function submit() {
    if (!body.trim() || disabled) return;
    setError(null);
    startTransition(async () => {
      const result = isNote
        ? await addTicketInternalNoteAction(ticketId, requestId, body)
        : mode === "client"
          ? await clientReplyTicketAction(ticketId, requestId, body)
          : await adminReplyTicketAction(ticketId, requestId, body);
      if (!result.ok) { setError(result.error); return; }
      setBody("");
      setRequestId(crypto.randomUUID());
      router.refresh();
    });
  }

  return <section className={isNote ? styles.noteComposer : styles.composer} aria-label={label}>
    <header>{isNote ? <LockKeyhole aria-hidden="true" /> : null}<strong>{label}</strong>{isNote ? <span>Visible to Wolf Forge staff only</span> : null}</header>
    <label><span className="sr-only">{label} message</span><textarea rows={4} value={body} onChange={(event) => setBody(event.target.value)} maxLength={50000} disabled={pending || disabled} placeholder={disabled ? "Replies are unavailable on closed Tickets." : isNote ? "Add private context for the team…" : "Write a reply…"} /></label>
    {error ? <p className={styles.actionError} role="alert">{error}</p> : null}
    <footer><span>{body.length.toLocaleString()} / 50,000</span><button className="button-primary" type="button" onClick={submit} disabled={pending || disabled || !body.trim()}>{pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Send aria-hidden="true" />}{isNote ? "Add note" : "Send reply"}</button></footer>
  </section>;
}
