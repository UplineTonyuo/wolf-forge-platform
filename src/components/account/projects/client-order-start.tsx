"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestClientOrderStart } from "../../../app/actions/client-order-start";
import type { ClientOrderStartState } from "../../../domain/orders/client-start";
import styles from "./client-order-start.module.css";

export function ClientOrderStart({ initial }: { initial: ClientOrderStartState | null }) {
  const [state, setState] = useState(initial);
  const [previousInitial, setPreviousInitial] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (initial !== previousInitial) {
    setPreviousInitial(initial);
    setState(initial);
  }
  if (!state) return null;
  if (state.started) return null;
  if (state.forms.length === 0) return <p role="alert">Required intake status could not be loaded. Reload before starting this order.</p>;
  if (!state.available) return <section className={styles.card}><h2>This order cannot be started</h2><p>Contact the team if you need help with this order.</p></section>;
  const complete = state.forms.every((form) => form.completed);
  return <section id="start-order" className={styles.card} aria-labelledby="client-start-title">
    <h2 id="client-start-title">{complete ? "Ready to start your order?" : "Complete your service form to begin"}</h2>
    <p>{state.requested ? "Your start request is saved. After all required forms are submitted, your order will automatically move to In progress." : complete ? "Your required forms are complete. You can start now or return later." : "Choose Start order to complete the required service forms. Your order begins only after all required forms are submitted."}</p>
    <ul>{state.forms.map((form) => <li key={form.id}><span>{form.title}</span>
      {form.completed ? <strong>Completed</strong> : form.available ? <Link href={`/account/onboarding/${form.id}`}>Complete intake form →</Link> : <span>Form unavailable — contact the team.</span>}</li>)}</ul>
    {state.requested && complete ? <p role="status">Your forms are saved. The start is awaiting confirmation; no further form submission is needed.</p> : null}
    <div className={styles.actions}>
      {state.forms.every((form) => form.completed || form.available) ? <button type="button" className="button-primary" disabled={pending} aria-busy={pending || undefined} onClick={() => startTransition(async () => {
        setError(null);
        try {
          const result = await requestClientOrderStart(state.order_id);
          if (!result.ok) setError(result.error);
          else {
            setState(result.state);
            if (result.state.started) router.refresh();
            else if (result.state.requested) {
              const next = result.state.forms.find((form) => !form.completed);
              if (next?.available) router.push(`/account/onboarding/${next.id}`);
            }
          }
        } catch { setError("Start status could not be confirmed. Check start status again to retry safely."); }
      })}>{pending ? "Checking…" : state.requested ? complete ? "Check start status" : "Continue form" : "Start order"}</button> : null}
      {!state.requested ? <Link href="/account/projects" className="button-secondary">Do this later</Link> : null}
    </div>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
