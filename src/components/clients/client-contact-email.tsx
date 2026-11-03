"use client";

import { Mail } from "lucide-react";
import { useState, useTransition } from "react";
import { sendClientContactEmailAction } from "../../app/actions/client-contact-email";
import { PortalDialog } from "../account/ui/portal-dialog";

export function ClientContactEmail({ contactId, name, email, available }: {
  contactId: string; name: string; email: string; available: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="client-email-link" onClick={() => setOpen(true)} aria-label={`Email ${name}`}>
    <Mail size={16} aria-hidden="true" />{email}
  </button>{open ? <ClientEmailComposer contactId={contactId} name={name} email={email} available={available} onClose={() => setOpen(false)} /> : null}</>;
}

export function ClientEmailComposer({ contactId, name, email, available, onClose,initialSubject="",initialBody="" }: {
  contactId: string; name: string; email: string; available: boolean; onClose: () => void;initialSubject?:string;initialBody?:string;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [requestId] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const [locked, setLocked] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return <PortalDialog open onClose={() => { if (!pending) onClose(); }} title={`Email ${name}`}
    description={`To: ${email}`} closeOnBackdrop={false} showClose>
    <form className="client-email-form" onSubmit={(event) => {
      event.preventDefault();
      if (pending || locked || !available) return;
      startTransition(async () => {
        try {
          const response = await sendClientContactEmailAction({ contactId, requestId, recipientEmail: email, subject, body });
          setResult(response);
          setLocked(Boolean(response.locked));
        } catch {
          setLocked(true);
          setResult({ ok: false, message: "The sending result is unknown. Check Gmail Sent before composing another email." });
        }
      });
    }}>
      {!available ? <p className="form-banner" role="status">Connect Gmail in Settings → Integrations to send email from this workspace.</p> : null}
      <label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} required maxLength={200} disabled={pending || locked} /></label>
      <label>Message<textarea value={body} onChange={(event) => setBody(event.target.value)} required maxLength={50_000} rows={8} disabled={pending || locked} /></label>
      {result ? <p role={result.ok ? "status" : "alert"} className={result.ok ? "success-banner" : "form-banner"}>{result.message}</p> : null}
      <footer><button type="button" className="button button-secondary" disabled={pending} onClick={onClose}>{locked ? "Done" : "Cancel"}</button>
        <button type="submit" className="button button-primary" disabled={pending || locked || !available || !subject.trim() || !body.trim()}>
          {pending ? "Sending…" : "Send email"}
        </button></footer>
    </form>
  </PortalDialog>;
}
