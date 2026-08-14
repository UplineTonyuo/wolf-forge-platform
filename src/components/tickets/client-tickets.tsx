"use client";

import { ArrowRight, LifeBuoy, LoaderCircle, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { createClientTicketAction } from "../../app/actions/tickets";
import type { ClientTicketSummary } from "../../domain/tickets/schema";
import { formatDateTime } from "../../lib/format";
import { TicketStatusBadge } from "./ticket-badges";
import styles from "./tickets.module.css";

export function ClientTickets({ summaries }: { summaries: ClientTicketSummary[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function createTicket() {
    if (!subject.trim() || !message.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createClientTicketAction({ requestId, subject, message });
      if (!result.ok) setError(result.error);
    });
  }

  return <>
    <section className={styles.clientListHeader}><div><span>Support</span><h1>Tickets</h1><p>Start a conversation with Wolf Forge and keep every reply in one place.</p></div><button className="button-primary" type="button" onClick={() => dialog.current?.showModal()}><Plus aria-hidden="true" />Create Ticket</button></section>
    {summaries.length === 0 ? <section className={styles.clientEmpty}><LifeBuoy aria-hidden="true" /><h2>No Tickets yet</h2><p>When you need help, create a Ticket and our team will respond here.</p><button className="button-primary" type="button" onClick={() => dialog.current?.showModal()}>Create your first Ticket</button></section> : <section className={styles.clientTicketList} aria-label="Your Tickets">{summaries.map((ticket) => <Link href={`/account/tickets/${ticket.ticket_id}`} key={ticket.ticket_id}><div className={styles.clientTicketIcon}><LifeBuoy aria-hidden="true" /></div><div className={styles.clientTicketTitle}><span>{ticket.public_ref}</span><strong>{ticket.subject}</strong><small>Updated {formatDateTime(ticket.last_message_at ?? ticket.updated_at)}</small></div><TicketStatusBadge status={ticket.status} /><ArrowRight aria-hidden="true" /></Link>)}</section>}
    <dialog className={styles.dialog} ref={dialog} onCancel={(event) => { if (pending) event.preventDefault(); }}>
      <form onSubmit={(event) => { event.preventDefault(); createTicket(); }}>
        <header><div><h2>Create a Ticket</h2><p>Tell us what you need help with. Your company and identity are added securely from your account.</p></div><button type="button" aria-label="Close" onClick={() => dialog.current?.close()} disabled={pending}><X aria-hidden="true" /></button></header>
        <div className={styles.dialogBody}><label><span>Subject</span><input autoFocus value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={500} required /></label><label><span>Message</span><textarea rows={7} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={50000} required /></label>{error ? <p className={styles.actionError} role="alert">{error}</p> : null}</div>
        <footer><button className="button-secondary" type="button" onClick={() => dialog.current?.close()} disabled={pending}>Cancel</button><button className="button-primary" type="submit" disabled={pending || !subject.trim() || !message.trim()}>{pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}Create Ticket</button></footer>
      </form>
    </dialog>
  </>;
}
