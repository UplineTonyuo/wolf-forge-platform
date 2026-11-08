"use client";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { completeProjectWithoutReportAction } from "../../app/actions/orders";
import type { ProjectOutcome } from "../../domain/orders/bulk";
import { reportCompletionHref, reportCompletionMonthLabel } from "../../domain/reporting/order-completion";
import { SheetFrame } from "../ui/mobile-filter-sheet";
import { useExitTransition } from "../team/use-exit-transition";
import styles from "../reporting/reporting.module.css";

export function OrderCompletionGate({ failures, onCompleted, onDismiss }: { failures: ProjectOutcome[]; onCompleted: (id: string) => void; onDismiss?: () => void }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const failure = failures.find((entry) => entry.completionRequirement && !dismissed.includes(entry.id));
  if (!failure?.completionRequirement) return null;
  return <CompletionSheet key={failure.id} failure={failure} onCompleted={onCompleted} onClose={() => {
    setDismissed((ids) => [...ids, failure.id]);
    if (!failures.some((entry) => entry.id !== failure.id && entry.completionRequirement && !dismissed.includes(entry.id))) onDismiss?.();
  }} />;
}

function CompletionSheet({ failure, onCompleted, onClose }: { failure: ProjectOutcome; onCompleted: (id: string) => void; onClose: () => void }) {
  const scope = failure.completionRequirement!;
  const fieldId = useId();
  const [exception, setException] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [completed, setCompleted] = useState(false);
  const { render: visible } = useExitTransition(open, 150);
  useEffect(() => {
    if (visible) return;
    if (completed) onCompleted(scope.orderId);
    onClose();
  }, [visible, completed, onCompleted, onClose, scope.orderId]);

  async function complete() {
    if (busy || !reason.trim() || reason.trim().length > 1000) return;
    setBusy(true);
    setError(null);
    try {
      const result = await completeProjectWithoutReportAction(scope.orderId, {
        serviceId: scope.serviceId, reportingPeriodMonth: scope.reportingPeriodMonth, reason: reason.trim(),
      });
      if (result.succeeded.some((entry) => entry.id === scope.orderId)) {
        setCompleted(true);
        setOpen(false);
      } else setError(result.failed[0]?.error ?? "The order could not be completed.");
    } catch {
      setError("The request could not be completed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <SheetFrame open={open} onClose={() => { if (!busy) setOpen(false); }} label="Monthly report required" eyebrow="" closeLabel="Close report requirement"
    footer={<div className={`${styles.setupActions} ${styles.completionActions}`}>
      <Link className={styles.primaryButton} href={reportCompletionHref(scope)}>Create report</Link>
      {scope.canRecordException && !exception ? <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => setException(true)}>Report not required</button> : null}
      {exception ? <button className={styles.secondaryButton} type="button" disabled={busy || !reason.trim() || reason.trim().length > 1000} aria-busy={busy || undefined} onClick={() => void complete()}>{busy ? "Completing…" : "Record exception and complete"}</button> : null}
    </div>}>
    <div className={styles.completionRequirement}>
      <strong>{failure.label}</strong>
      <p>{scope.serviceName} · <strong>{reportCompletionMonthLabel(scope.reportingPeriodMonth)}</strong></p>
      <p>Publish a client-visible report for this client, Service and reporting month before completing the order. A draft does not qualify.</p>
      {exception ? <div className={styles.field}>
        <label htmlFor={fieldId}>Reason</label>
        <textarea id={fieldId} value={reason} onChange={(event) => setReason(event.currentTarget.value)} maxLength={1000} rows={4} required disabled={busy} />
        <em className={styles.fieldHint}>Saved with your identity and time for this order and month only.</em>
      </div> : null}
      {error ? <p className={styles.problems} role="alert">{error}</p> : null}
    </div>
  </SheetFrame>;
}
