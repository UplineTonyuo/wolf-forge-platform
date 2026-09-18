"use client";

import { LoaderCircle, MoreHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import {
  cancelSubscriptionAction,
  pauseSubscriptionAction,
  removeSubscriptionCancellationAction,
  resumeSubscriptionAction,
  scheduleSubscriptionCancellationAction,
} from "../../app/actions/subscriptions";
import type { SubscriptionCapabilities, SubscriptionSummary } from "../../domain/subscriptions/schema";
import styles from "./subscriptions.module.css";

type ActionKind = "pause" | "resume" | "schedule" | "remove" | "cancel";

export function availableSubscriptionActions(
  status: SubscriptionSummary["status"],
  capabilities: SubscriptionCapabilities,
) {
  return {
    edit: capabilities.manage && status !== "canceled",
    pause: capabilities.pause && ["active", "past_due"].includes(status),
    resume: capabilities.pause && status === "paused",
    schedule: capabilities.cancel && ["active", "past_due"].includes(status),
    remove: capabilities.cancel && status === "pending_cancellation",
    cancel: capabilities.cancel && status !== "canceled",
  };
}

const modalCopy: Record<ActionKind, { title: string; body: string; confirm: string }> = {
  pause: { title: "Pause subscription", body: "Billing cycles will be suspended. The original billing anchor is preserved.", confirm: "Pause Subscription" },
  resume: { title: "Resume subscription", body: "Billing will resume on the original anchor. Paused periods are skipped and are not back-billed.", confirm: "Resume Subscription" },
  schedule: { title: "Cancel at period end", body: "The Subscription will remain available through its current period, then future billing stops.", confirm: "Schedule Cancellation" },
  remove: { title: "Keep Subscription Active", body: "Remove the scheduled cancellation and continue billing from the preserved anchor.", confirm: "Keep Subscription Active" },
  cancel: { title: "Cancel now", body: "Future cycles stop immediately. Historical invoices, payments, billing cycles, and events remain intact.", confirm: "Cancel Subscription" },
};

export function SubscriptionActions({
  subscriptionId,
  status,
  capabilities,
}: {
  subscriptionId: string;
  status: SubscriptionSummary["status"];
  capabilities: SubscriptionCapabilities;
}) {
  const actions = availableSubscriptionActions(status, capabilities);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const router = useRouter();
  const [kind, setKind] = useState<ActionKind>("pause");
  const [reason, setReason] = useState("");
  const [resumeMode, setResumeMode] = useState<"manual" | "date">("manual");
  const [resumesAt, setResumesAt] = useState("");
  const [minimumResumeDate, setMinimumResumeDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open(nextKind: ActionKind) {
    setKind(nextKind);
    setReason("");
    setResumeMode("manual");
    setResumesAt("");
    if (nextKind === "pause") {
      setMinimumResumeDate(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
    }
    setError(null);
    menuRef.current?.removeAttribute("open");
    dialogRef.current?.showModal();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = kind === "pause"
        ? await pauseSubscriptionAction(subscriptionId, resumeMode === "date" ? resumesAt : null)
        : kind === "resume"
          ? await resumeSubscriptionAction(subscriptionId)
          : kind === "schedule"
            ? await scheduleSubscriptionCancellationAction(subscriptionId, reason)
            : kind === "remove"
              ? await removeSubscriptionCancellationAction(subscriptionId)
              : await cancelSubscriptionAction(subscriptionId, reason);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      dialogRef.current?.close();
      router.refresh();
    });
  }

  const primary = actions.remove
    ? <button className="button-primary" type="button" onClick={() => open("remove")}>Keep Subscription Active</button>
    : actions.resume
      ? <button className="button-primary" type="button" onClick={() => open("resume")}>Resume</button>
      : null;

  return (
    <>
      <div className={styles.detailActions}>
        {primary}
        {actions.edit || actions.pause || actions.schedule || actions.cancel ? <details ref={menuRef}>
          <summary className="button-secondary" aria-label="Subscription actions"><MoreHorizontal aria-hidden="true" /></summary>
          <div>
            {actions.edit ? <Link href={`/subscriptions/${subscriptionId}/edit`}>Edit plan</Link> : null}
            {actions.pause ? <button type="button" onClick={() => open("pause")}>Pause</button> : null}
            {actions.schedule ? <button type="button" onClick={() => open("schedule")}>Cancel at period end</button> : null}
            {actions.cancel ? <button className={styles.dangerAction} type="button" onClick={() => open("cancel")}>Cancel now</button> : null}
          </div>
        </details> : null}
      </div>

      <dialog className={styles.dialog} ref={dialogRef} onCancel={(event) => { if (pending) event.preventDefault(); }}>
        <form onSubmit={submit}>
          <header><div><h2>{modalCopy[kind].title}</h2><p>{modalCopy[kind].body}</p></div><button type="button" aria-label="Close" onClick={() => dialogRef.current?.close()} disabled={pending}><X aria-hidden="true" /></button></header>
          {kind === "pause" ? <fieldset className={styles.modalChoices}><legend>Resume</legend><label><input type="radio" checked={resumeMode === "manual"} onChange={() => setResumeMode("manual")} />Manually</label><label><input type="radio" checked={resumeMode === "date"} onChange={() => setResumeMode("date")} />On date</label>{resumeMode === "date" ? <input aria-label="Resume date" type="date" required min={minimumResumeDate} value={resumesAt} onChange={(event) => setResumesAt(event.currentTarget.value)} /> : null}</fieldset> : null}
          {kind === "schedule" || kind === "cancel" ? <label className={styles.modalField}><span>Reason <small>optional</small></span><textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.currentTarget.value)} /></label> : null}
          {error ? <p className={styles.formError} role="alert">{error}</p> : null}
          <footer><button className="button-secondary" type="button" onClick={() => dialogRef.current?.close()} disabled={pending}>Back</button><button className={kind === "cancel" ? styles.dangerButton : "button-primary"} type="submit" aria-busy={pending || undefined} disabled={pending || (kind === "pause" && resumeMode === "date" && !resumesAt)}>{pending ? <><LoaderCircle className="spinner" aria-hidden="true" />Saving…</> : modalCopy[kind].confirm}</button></footer>
        </form>
      </dialog>
    </>
  );
}
