"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestClientOrderStart } from "../../../app/actions/client-order-start";
import type { ClientOrderStartState } from "../../../domain/orders/client-start";
import styles from "./client-order-start.module.css";

export function ClientOrderStart({ initial }: { initial: ClientOrderStartState | null }) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (!state) return null;
  if (state.started) return <section className={styles.card} role="status"><h2>{state.status === "working" ? "Your order is in progress" : "Your order was started"}</h2><p>Your required service forms were completed and your start request was confirmed. The current project status is shown above.</p></section>;
  if (!state.available) return <section className={styles.card}><h2>This order cannot be started</h2><p>Contact the team if you need help with this order.</p></section>;
  return <section className={styles.card} aria-labelledby="client-start-title">
    <h2 id="client-start-title">{state.requested ? "Complete your service form to begin" : "Ready to start your order?"}</h2>
    <p>{state.requested ? "Your start request is saved. After all required forms are submitted, your order will automatically move to In progress." : "You can start now or return later. Complete the required form for this service before work begins."}</p>
    {state.requested ? <ul>{state.forms.map((form) => <li key={form.id}><span>{form.title}</span>
      {form.completed ? <strong>Completed</strong> : form.available ? <Link href={`/account/onboarding/${form.id}`}>Complete form →</Link> : <span>Form unavailable — contact the team.</span>}</li>)}</ul> : null}
    {state.requested && state.forms.every((form) => form.completed) ? <p role="status">Your forms are saved. The start is awaiting confirmation; no further form submission is needed.</p> : null}
    <div className={styles.actions}>
      {(!state.requested || state.forms.every((form) => form.completed)) ? <button type="button" className="button-primary" disabled={pending} aria-busy={pending || undefined} onClick={() => startTransition(async () => {
        setError(null);
        const result = await requestClientOrderStart(state.order_id);
        if (!result.ok) setError(result.error);
        else { setState(result.state); if (result.state.started) router.refresh(); }
      })}>{pending ? "Checking…" : state.requested ? "Check start status" : "Start order"}</button> : null}
      {!state.requested ? <Link href="/account/projects" className="button-secondary">Do this later</Link> : null}
    </div>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
