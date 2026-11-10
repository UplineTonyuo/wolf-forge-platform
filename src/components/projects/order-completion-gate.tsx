"use client";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { completeProjectForReportingMonthAction, completeProjectWithoutReportAction } from "../../app/actions/orders";
import type { ProjectOutcome } from "../../domain/orders/bulk";
import { reportCompletionHref, reportCompletionMonthLabel, reportCompletionScopeSchema } from "../../domain/reporting/order-completion";
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
  const [scope, setScope] = useState(failure.completionRequirement!);
  const [monthInput, setMonthInput] = useState(scope.reportingPeriodMonth?.slice(0, 7) ?? "");
  const selectedPeriod = reportCompletionScopeSchema.safeParse({ serviceId: scope.serviceId, reportingPeriodMonth: `${monthInput}-01` });
  const monthConfirmed = selectedPeriod.success && selectedPeriod.data.reportingPeriodMonth === scope.reportingPeriodMonth;
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

  async function complete(withException: boolean) {
    if (busy || !selectedPeriod.success || (withException && (!monthConfirmed || !reason.trim() || reason.trim().length > 1000))) return;
    setBusy(true);
    setError(null);
    try {
      const result = withException
        ? await completeProjectWithoutReportAction(scope.orderId, { ...selectedPeriod.data, reason: reason.trim() })
        : await completeProjectForReportingMonthAction(scope.orderId, selectedPeriod.data);
      if (result.succeeded.some((entry) => entry.id === scope.orderId)) {
        setCompleted(true);
        setOpen(false);
      } else {
        const failed = result.failed.find((entry) => entry.id === scope.orderId);
        if (failed?.completionRequirement) {
          setScope(failed.completionRequirement);
          setMonthInput(failed.completionRequirement.reportingPeriodMonth?.slice(0, 7) ?? "");
        }
        setError(failed?.error ?? "The order could not be completed.");
      }
    } catch {
      setError("The request could not be completed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <SheetFrame open={open} onClose={() => { if (!busy) setOpen(false); }} label="Monthly report required" eyebrow="" closeLabel="Close report requirement"
    footer={<div className={`${styles.setupActions} ${styles.completionActions}`}>
      {!exception ? <button className={styles.primaryButton} type="button" disabled={busy || !selectedPeriod.success} aria-busy={busy || undefined} onClick={() => void complete(false)}>{busy ? "Checking…" : "Check report and complete"}</button> : null}
      {monthConfirmed && selectedPeriod.success ? <Link className={styles.secondaryButton} href={reportCompletionHref({ companyId: scope.companyId, ...selectedPeriod.data })}>Create report</Link> : null}
      {scope.canRecordException && monthConfirmed && !exception ? <button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => setException(true)}>Report not required</button> : null}
      {exception ? <button className={styles.primaryButton} type="button" disabled={busy || !monthConfirmed || !reason.trim() || reason.trim().length > 1000} aria-busy={busy || undefined} onClick={() => void complete(true)}>{busy ? "Completing…" : "Record exception and complete"}</button> : null}
    </div>}>
    <div className={styles.completionRequirement}>
      <strong>{failure.label}</strong>
      <p>{scope.serviceName}{scope.reportingPeriodMonth ? <> · <strong>{reportCompletionMonthLabel(scope.reportingPeriodMonth)}</strong></> : null}</p>
      <div className={styles.field}>
        <label htmlFor={`${fieldId}-month`}>Month the work covers</label>
        <input id={`${fieldId}-month`} type="month" value={monthInput} required disabled={busy} onChange={(event) => {
          setMonthInput(event.currentTarget.value);
          setException(false);
          setReason("");
          setError(null);
        }} />
        <em className={styles.fieldHint}>Choose the month this work covers, even if the order started or is completed in another month.</em>
      </div>
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
