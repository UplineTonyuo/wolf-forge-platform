"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  setFolderSubscriptionEligibilityAction,
  type CatalogFormState,
} from "../../app/actions/services";
import { folderSubscriptionSummary, type EligibilityService, type FolderSubscriptionState } from "./folder-subscription-summary";
import styles from "./folder-subscription-control.module.css";

const stateLabels: Record<FolderSubscriptionState, string> = {
  all: "Every active service in this folder can be subscribed to.",
  none: "No service in this folder can be subscribed to.",
  mixed: "Mixed: some services are available, some are not.",
};

function ConfirmButton({ eligible }: { eligible: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className={eligible ? "button-primary" : "button-danger"} disabled={pending} aria-busy={pending || undefined} type="submit">
      {pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}
      {eligible ? "Mark all eligible" : "Remove all"}
    </button>
  );
}

export function FolderSubscriptionControl({
  folderId,
  folderName,
  services,
}: {
  folderId: string;
  folderName: string;
  services: EligibilityService[];
}) {
  const { eligible, total, state } = folderSubscriptionSummary(services);
  const [target, setTarget] = useState<boolean | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const checkboxRef = useRef<HTMLInputElement>(null);
  const initialState: CatalogFormState = { error: null };
  const [markState, markAction] = useActionState(setFolderSubscriptionEligibilityAction.bind(null, folderId, true), initialState);
  const [clearState, clearAction] = useActionState(setFolderSubscriptionEligibilityAction.bind(null, folderId, false), initialState);
  const error = target === false ? clearState.error : markState.error;

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = state === "mixed";
  }, [state]);

  function confirm(next: boolean) {
    setTarget(next);
    dialogRef.current?.showModal();
  }

  const affected = target ? total - eligible : eligible;

  return (
    <section className="service-form-section service-folder-form" aria-labelledby="folder-subscription-heading">
      <div className="service-form-section-heading">
        <h2 id="folder-subscription-heading">Subscription availability</h2>
      </div>
      <div className={styles.body}>
        {/* Read-only tri-state: the folder has no setting of its own. */}
        <div className="service-toggle">
          <input ref={checkboxRef} type="checkbox" checked={state === "all"} readOnly tabIndex={-1} aria-hidden="true" />
          <span>
            <strong>{total === 0 ? "No active services in this folder" : `${eligible} of ${total} services available for subscriptions`}</strong>
            <small>{total === 0 ? "Add services to manage their subscription availability." : stateLabels[state]}</small>
          </span>
        </div>
        <div className={styles.actions}>
          <button className="button-secondary" type="button" disabled={total === 0 || state === "all"} onClick={() => confirm(true)}>
            Mark all services subscription eligible
          </button>
          <button className="button-secondary" type="button" disabled={total === 0 || state === "none"} onClick={() => confirm(false)}>
            Remove all services from subscriptions
          </button>
        </div>
        <small className="service-field-help">Individual services below may still be edited separately.</small>
      </div>

      <dialog
        className={styles.dialog}
        ref={dialogRef}
        aria-labelledby="folder-subscription-dialog-title"
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
      >
        <form action={target ? markAction : clearAction} className={styles.dialogBody}>
          <h2 id="folder-subscription-dialog-title">
            {target ? "Make all services available?" : "Remove all services from subscriptions?"}
          </h2>
          <p>
            {target
              ? `${affected} ${affected === 1 ? "service" : "services"} in ${folderName} will become selectable for new subscriptions.`
              : `${affected} ${affected === 1 ? "service" : "services"} in ${folderName} will no longer be selectable for new subscriptions. Existing subscriptions keep their services.`}
          </p>
          {error ? <div className="form-banner" role="alert">{error}</div> : null}
          <div className={styles.dialogActions}>
            <button className="button-secondary" type="button" onClick={() => dialogRef.current?.close()}>Cancel</button>
            <ConfirmButton eligible={target ?? true} />
          </div>
        </form>
      </dialog>
    </section>
  );
}
