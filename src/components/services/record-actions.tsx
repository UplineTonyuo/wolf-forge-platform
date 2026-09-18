"use client";

import { Copy, LoaderCircle, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  archiveServiceAction,
  archiveServiceFolderAction,
  duplicateServiceAction,
  type CatalogFormState,
} from "../../app/actions/services";

function ActionButton({ kind }: { kind: "duplicate" | "archive-service" | "archive-folder" }) {
  const { pending } = useFormStatus();
  const archive = kind !== "duplicate";
  return (
    <button className={archive ? "button-danger" : "button-secondary"} disabled={pending} aria-busy={pending || undefined} type="submit">
      {pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : archive ? <Trash2 aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {kind === "duplicate" ? "Duplicate service" : kind === "archive-folder" ? "Soft delete folder" : "Soft delete service"}
    </button>
  );
}

export function ServiceRecordActions({ serviceId }: { serviceId: string }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const initialState: CatalogFormState = { error: null };
  const [duplicateState, duplicateAction] = useActionState(duplicateServiceAction.bind(null, serviceId), initialState);
  const [archiveState, archiveAction] = useActionState(archiveServiceAction.bind(null, serviceId), initialState);

  return (
    <div className="service-record-actions">
      <form action={duplicateAction}><input type="hidden" name="request_id" value={requestId} /><ActionButton kind="duplicate" /></form>
      <form action={archiveAction}><ActionButton kind="archive-service" /></form>
      {duplicateState.error || archiveState.error ? <p className="field-error" role="alert">{duplicateState.error ?? archiveState.error}</p> : null}
    </div>
  );
}

export function FolderRecordActions({ folderId }: { folderId: string }) {
  const initialState: CatalogFormState = { error: null };
  const [state, action] = useActionState(archiveServiceFolderAction.bind(null, folderId), initialState);
  return (
    <div className="service-record-actions">
      <form action={action}><ActionButton kind="archive-folder" /></form>
      {state.error ? <p className="field-error" role="alert">{state.error}</p> : null}
    </div>
  );
}
