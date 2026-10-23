"use client";

import { useEffect, useId, useRef, useState } from "react";
import { preflightWhiteLabelPublicationAction, publishWhiteLabelDraftAction, reconcileWhiteLabelPublicationAction } from "../../app/actions/white-label-publication";
import { decodePublicationPreflight, decodePublicationReconciliation, decodePublishWhiteLabelResult, publishWhiteLabelSchema, type PublicationBlockerCode, type PublicationPreflight, type PublicationReceipt, type PublishWhiteLabelInput } from "../../domain/white-label/publication";
import type { WhiteLabelDraft } from "../../domain/white-label/draft";
import { PortalDialog } from "../account/ui/portal-dialog";
import { clearConfirmedPublicationIntent, readPublicationIntent, storePublicationIntent } from "./publication-intent";
import styles from "./white-label-builder.module.css";

const BLOCKERS: Record<PublicationBlockerCode, string> = {
  DRAFT_NOT_SAVED: "Save a draft before reviewing publication.",
  STALE_DRAFT: "The saved draft changed. Reload it and review the new revision.",
  STALE_PUBLICATION: "The publication revision changed. Explicitly check the current revision again.",
  TENANT_INACTIVE: "This Tenant is inactive and cannot publish.",
  SERVICES_REQUIRED: "Services is required for publication. Enable it explicitly and save a new draft.",
  INVALID_MODULE_POLICY: "The saved module choices do not meet publication dependencies.",
  OUTSTANDING_PROJECTS: "Unfinished Projects prevent this module change.",
  OUTSTANDING_TICKETS: "Open Tickets prevent this module change.",
  UNCANCELED_SUBSCRIPTIONS: "Uncanceled Subscriptions prevent this module change.",
  OUTSTANDING_FINANCIAL_OBLIGATIONS: "Outstanding or pending financial obligations prevent this module change.",
};

type Props = {
  actorId: string;
  draft: WhiteLabelDraft;
  hasChanges: boolean;
  draftValid: boolean;
  busy: boolean;
  onConfirmed: () => void;
  onReload: () => void;
};

export function WhiteLabelPublicationControls(props: Props) {
  return <ScopedPublicationControls key={`${props.actorId}:${props.draft.tenantId}:${props.draft.revision}`} {...props} />;
}

function ScopedPublicationControls({ actorId, draft, hasChanges, draftValid, busy, onConfirmed, onReload }: Props) {
  const id = useId();
  const mounted = useRef(false);
  const checkGeneration = useRef(0);
  const inFlight = useRef(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState(false);
  const [pending, setPending] = useState<PublishWhiteLabelInput | null>(null);
  const [preflight, setPreflight] = useState<PublicationPreflight | null>(null);
  const [expectedRevision, setExpectedRevision] = useState(0);
  const [operation, setOperation] = useState<"check" | "publish" | "reconcile" | null>(null);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState<"new" | "retry" | null>(null);
  const [receipt, setReceipt] = useState<PublicationReceipt | null>(null);
  const [receiptOutcome, setReceiptOutcome] = useState("");
  const [observedRevision, setObservedRevision] = useState<number | null>(null);
  const [retryAllowed, setRetryAllowed] = useState(false);
  const [denied, setDenied] = useState(false);

  function redactOnRefusal(code: string) {
    if (code !== "PERMISSION_DENIED" && code !== "NOT_FOUND") return;
    setDenied(true); setReceipt(null); setObservedRevision(null); setReason(""); setConfirmation(null);
  }

  function loadRecovery() {
    try {
      const recovered = readPublicationIntent(window.sessionStorage, actorId, draft.tenantId);
      setPending(recovered);
      setReceipt(null); setObservedRevision(null); setRetryAllowed(false); setPreflight(null);
      setMessage(recovered ? "A retained publication request needs reconciliation before any retry." : "");
      setRecoveryError(false);
    } catch {
      setRecoveryError(true);
    }
    setRecoveryReady(true);
  }

  useEffect(() => {
    const generation = checkGeneration;
    mounted.current = true;
    queueMicrotask(() => { if (mounted.current) loadRecovery(); });
    return () => { mounted.current = false; ++generation.current; };
    // The editor keys this component by verified actor, Tenant and saved draft revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasChanges) return;
    ++checkGeneration.current;
    queueMicrotask(() => {
      if (!mounted.current) return;
      setPreflight(null);
      setConfirmation(null);
      setOperation((current) => current === "check" ? null : current);
    });
  }, [hasChanges]);

  const saved = draft.revision > 0 && draft.tenantStatus === "active" && draftValid && !hasChanges;
  const canCheck = saved && !busy && !operation;
  const ready = saved && preflight?.publishable === true && preflight.sourceDraftRevision === draft.revision &&
    preflight.currentDraftRevision === draft.revision && preflight.currentPublicationRevision === preflight.expectedPublicationRevision;
  const reasonValid = publishWhiteLabelSchema.shape.reason.safeParse(reason).success;
  const canPublish = ready && reasonValid && recoveryReady && !recoveryError && !pending && !busy && !operation;

  async function check(expected = expectedRevision, effective = false) {
    if (inFlight.current || busy || (!effective && !saved)) return;
    const request = ++checkGeneration.current;
    setOperation("check");
    setMessage("");
    if (!effective) setPreflight(null);
    try {
      const input = { tenantId: draft.tenantId, sourceDraftRevision: effective && receipt ? receipt.configuration.sourceDraftRevision : draft.revision, expectedPublicationRevision: expected };
      const response = await preflightWhiteLabelPublicationAction(actorId, input);
      if (!mounted.current || request !== checkGeneration.current) return;
      if (!response.ok) { redactOnRefusal(response.error.code); throw new Error(response.error.message); }
      const data = decodePublicationPreflight(response.data);
      if (data.tenantId !== input.tenantId || data.sourceDraftRevision !== input.sourceDraftRevision || data.expectedPublicationRevision !== expected) throw new Error("Publication check scope changed.");
      if (effective) {
        if (!receipt || data.currentPublicationRevision < receipt.configuration.publicationRevision) throw new Error("Effective publication state is unavailable.");
        setObservedRevision(data.currentPublicationRevision);
      } else {
        setExpectedRevision(expected);
        setPreflight(data);
      }
    } catch {
      if (mounted.current && request === checkGeneration.current) setMessage("Publication eligibility or effective state could not be checked. No permission to publish was inferred.");
    } finally {
      if (mounted.current && request === checkGeneration.current) setOperation(null);
    }
  }

  function confirmed(value: PublicationReceipt, outcome: string) {
    setReceipt(value);
    setReceiptOutcome(outcome);
    setObservedRevision(null);
    setRetryAllowed(false);
    setMessage("");
    onConfirmed();
  }

  async function publish(retry: boolean) {
    if (inFlight.current || busy || recoveryError || !recoveryReady || (retry ? !pending || !retryAllowed : !canPublish)) return;
    let input: PublishWhiteLabelInput;
    try {
      if (retry && pending) {
        const recovered = readPublicationIntent(window.sessionStorage, actorId, draft.tenantId);
        if (!recovered || JSON.stringify(recovered) !== JSON.stringify(pending)) throw new Error("Publication recovery changed.");
        input = recovered;
      } else {
        input = publishWhiteLabelSchema.parse({ tenantId: draft.tenantId, sourceDraftRevision: draft.revision, expectedPublicationRevision: preflight!.expectedPublicationRevision, requestId: crypto.randomUUID(), reason });
        storePublicationIntent(window.sessionStorage, actorId, input);
        setPending(input);
      }
    } catch {
      setRecoveryError(true);
      setConfirmation(null);
      return;
    }
    inFlight.current = true;
    ++checkGeneration.current;
    setConfirmation(null);
    setOperation("publish");
    setRetryAllowed(false);
    setPreflight(null);
    setMessage("Publication confirmation pending. The original request is retained.");
    try {
      const response = await publishWhiteLabelDraftAction(actorId, input);
      if (!mounted.current) return;
      if (!response.ok) { redactOnRefusal(response.error.code); setMessage(`${response.error.code === "CONFLICT" ? "Publication conflict." : "Publication was refused or not confirmed."} Reconcile the original request before retrying.`); return; }
      const data = decodePublishWhiteLabelResult(response.data);
      confirmed(data.receipt, data.outcome === "already_applied" ? "Already applied" : "Published");
    } catch {
      if (mounted.current) setMessage("Publication outcome unknown. Reconcile the retained request before any retry.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setOperation(null);
    }
  }

  async function reconcile() {
    if (!pending || inFlight.current || busy || recoveryError) return;
    let input: PublishWhiteLabelInput;
    try {
      const recovered = readPublicationIntent(window.sessionStorage, actorId, draft.tenantId);
      if (!recovered || JSON.stringify(recovered) !== JSON.stringify(pending)) throw new Error("Publication recovery changed.");
      input = recovered;
    } catch { setRecoveryError(true); return; }
    inFlight.current = true;
    setOperation("reconcile");
    setRetryAllowed(false);
    try {
      const response = await reconcileWhiteLabelPublicationAction(actorId, input);
      if (!mounted.current) return;
      if (!response.ok) { redactOnRefusal(response.error.code); throw new Error(response.error.message); }
      const data = decodePublicationReconciliation(response.data);
      if (data.outcome === "applied") confirmed(data.receipt, "Applied request confirmed");
      else {
        setMessage("No committed receipt was visible. An in-flight request can still commit. You may retry only the original unchanged request.");
        setRetryAllowed(true);
      }
    } catch {
      if (mounted.current) { setReceipt(null); setObservedRevision(null); setMessage("The original request remains unresolved. Outcome checks require current authorization; no new request was created."); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setOperation(null);
    }
  }

  function startAnotherReview() {
    if (!receipt || !pending || operation) return;
    try {
      clearConfirmedPublicationIntent(window.sessionStorage, actorId, pending);
      setPending(null); setReceipt(null); setPreflight(null); setObservedRevision(null); setReason(""); setMessage(""); setRetryAllowed(false);
    } catch { setRecoveryError(true); }
  }

  if (denied) return <section className={styles.reviewChecks} aria-label="Saved draft publication"><p role="alert">Publication controls are unavailable to the current session. Reload to verify access. Original recovery intent remains retained for its actor and Tenant.</p></section>;

  return <section className={styles.reviewChecks} aria-label="Saved draft publication">
    <h3>Publish saved draft</h3>
    <p className={styles.hint}>Publication uses saved revision {draft.revision || "(not saved)"}. Preflight is advisory; Publish repeats current authorization and policy checks.</p>
    {!saved ? <p className={styles.warning}>Save and review a valid draft for an active Tenant before checking eligibility. Unsaved changes are never published.</p> : null}
    {!recoveryReady ? <p role="status">Loading publication recovery state…</p> : null}
    {recoveryError ? <div role="alert"><p>Publication recovery is unavailable or invalid. New publication is blocked; existing intent was not discarded.</p><button type="button" className="button-secondary" onClick={loadRecovery} disabled={Boolean(operation)}>Reload recovery state</button></div> : null}
    {pending ? <p className={styles.hint}>Retained request for saved draft revision {pending.sourceDraftRevision}, replacing publication revision {pending.expectedPublicationRevision}. Draft changes do not replace this request.</p> : null}
    {message ? <p className={styles.warning} role="status">{message}</p> : null}
    {receipt ? <div role="status">
      <p>{receiptOutcome} · publication revision {receipt.configuration.publicationRevision} from saved draft revision {receipt.configuration.sourceDraftRevision}.</p>
      <p className={styles.hint}>{observedRevision === null ? "This immutable receipt is historical until current publication state is checked." : observedRevision === receipt.configuration.publicationRevision ? "The receipt matches the last observed publication revision. Runtime access remains independently authorized." : `Historical receipt. Publication revision ${observedRevision} was current at the last check.`}</p>
      <div className={styles.reviewActions}><button type="button" className="button-secondary" disabled={busy || Boolean(operation)} onClick={() => void check(receipt.configuration.publicationRevision, true)}>Check current publication</button><button type="button" className="button-secondary" disabled={busy || Boolean(operation) || recoveryError} onClick={startAnotherReview}>Start another review</button></div>
    </div> : pending ? <div className={styles.reviewActions}>
      <button type="button" className="button-secondary" disabled={busy || Boolean(operation) || recoveryError} onClick={() => void reconcile()}>{operation === "reconcile" ? "Checking outcome…" : "Reconcile publication outcome"}</button>
      {retryAllowed ? <button type="button" className="button-primary" disabled={busy || Boolean(operation) || recoveryError} onClick={() => setConfirmation("retry")}>Retry original publication request</button> : null}
    </div> : <>
      <p className={styles.hint}>{preflight ? `Checked saved revision ${preflight.sourceDraftRevision} against publication revision ${preflight.expectedPublicationRevision}.` : "Publication eligibility has not been checked."}</p>
      {preflight?.blockers.length ? <ul>{preflight.blockers.map(({ code }) => <li key={code}>{BLOCKERS[code]}</li>)}</ul> : null}
      {ready ? <p className={styles.hint}>The saved draft passed advisory preflight. Conditions can change before Publish.</p> : null}
      <div className={styles.reviewActions}>
        <button type="button" className="button-secondary" disabled={!canCheck} onClick={() => void check()}>{operation === "check" ? "Checking eligibility…" : "Check publication eligibility"}</button>
        {preflight?.blockers.some(({ code }) => code === "STALE_PUBLICATION") ? <button type="button" className="button-secondary" disabled={!canCheck} onClick={() => void check(preflight.currentPublicationRevision)}>Recheck current publication revision</button> : null}
        {preflight?.blockers.some(({ code }) => code === "STALE_DRAFT") ? <button type="button" className="button-secondary" disabled={busy || Boolean(operation)} onClick={onReload}>Reload saved draft</button> : null}
      </div>
      <label className={styles.field} htmlFor={`${id}-reason`}><span>Publication reason</span><input id={`${id}-reason`} type="text" maxLength={1000} value={reason} disabled={Boolean(operation)} onChange={(event) => setReason(event.target.value)} aria-describedby={`${id}-reason-help`} /></label>
      <p id={`${id}-reason-help`} className={styles.hint}>Use 1–500 characters. The reason is bound to the publication request.</p>
      <button type="button" className="button-primary" disabled={!canPublish} onClick={() => setConfirmation("new")}>Publish saved draft</button>
    </>}
    <PortalDialog open={confirmation !== null} onClose={() => setConfirmation(null)} title={confirmation === "retry" ? "Retry original publication" : "Publish saved draft"} initialFocusRef={cancelButton} closeOnBackdrop={false} footer={<div className={styles.reviewActions}>
      <button ref={cancelButton} type="button" className="button-secondary" onClick={() => setConfirmation(null)}>Keep reviewing</button>
      <button type="button" className="button-primary" disabled={confirmation === "retry" ? !retryAllowed || !pending || busy || Boolean(operation) || recoveryError : !canPublish} onClick={() => void publish(confirmation === "retry")}>Confirm publication</button>
    </div>}>
      <p>This deliberately publishes {confirmation === "retry" && pending ? `the original saved revision ${pending.sourceDraftRevision} with its unchanged request and reason` : `saved revision ${draft.revision} of ${draft.state.displayName}, replacing publication revision ${preflight?.expectedPublicationRevision ?? expectedRevision}`}.</p>
      <p>Reason: {confirmation === "retry" ? pending?.reason : reason}</p>
      <p>Published module policy can affect Tenant workspace access. The server rechecks authority, revisions and outstanding obligations before committing.</p>
    </PortalDialog>
  </section>;
}
