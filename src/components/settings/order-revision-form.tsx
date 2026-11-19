"use client";

import { useRef, useState, useTransition } from "react";
import { requestClientRevision } from "../../app/actions/process";

export function OrderRevisionForm({orderId, completedAt}: {orderId: string; completedAt: string}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [pending, startTransition] = useTransition();
  const lastRequest = useRef<{reason: string; id: string} | null>(null);

  function submit() {
    const text = reason.trim();
    if (!text || pending || accepted) return;
    if (lastRequest.current?.reason !== text) {
      lastRequest.current = {reason: text, id: crypto.randomUUID()};
    }
    const requestId = lastRequest.current.id;
    setError("");
    startTransition(async () => {
      try {
        const result = await requestClientRevision(orderId, completedAt, requestId, text);
        if (result.error) setError(result.error);
        else setAccepted(true);
      } catch {
        setError("Could not confirm the revision. Try submitting it again.");
      }
    });
  }

  if (accepted) return <p role="status">Revision requested.</p>;
  return (
    <form action={submit} className="portal-section">
      <label>
        What needs revision?
        <textarea name="reason" required maxLength={4000} value={reason} disabled={pending}
          onChange={event => setReason(event.target.value)}/>
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={!reason.trim() || pending}>Request revision</button>
    </form>
  );
}
