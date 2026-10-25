"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createServiceFolderAction,
  updateServiceFolderAction,
  type CatalogFormState,
} from "../../app/actions/services";
import type { ServiceFolderRow } from "../../lib/supabase/database-rows";
import { AnimatedSelect } from "../ui/animated-select";

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="button-primary" disabled={pending} aria-busy={pending || undefined} type="submit">
      <LoaderCircle className="spinner" aria-hidden="true" style={{ visibility: pending ? "visible" : "hidden", animationPlayState: pending ? "running" : "paused" }} />
      {editing ? "Save folder" : "Create folder"}
    </button>
  );
}

export function FolderForm({ folder, folders }: { folder?: ServiceFolderRow; folders: ServiceFolderRow[] }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [parentId, setParentId] = useState(folder?.parent_id ?? "");
  const updateAction = folder ? updateServiceFolderAction.bind(null, folder.id) : null;
  const initialState: CatalogFormState = { error: null };
  const [state, action] = useActionState(updateAction ?? createServiceFolderAction, initialState);

  return (
    <form action={action} className="service-editor-form service-folder-form">
      <input type="hidden" name="request_id" value={requestId} />
      {state.error ? <div className="form-banner" role="alert">{state.error}</div> : null}
      <section className="service-form-section">
        <div className="service-form-section-heading">
          <span>01</span>
          <div><h2>Folder details</h2><p>Organize related services without changing their Project relationship.</p></div>
        </div>
        <div className="service-form-fields">
          <label className="service-field service-field-wide" htmlFor="folder-name">
            <span>Folder name</span>
            <input id="folder-name" name="name" defaultValue={folder?.name ?? ""} maxLength={200} required />
          </label>
          <label className="service-field service-field-wide" htmlFor="folder-description">
            <span>Description <small>optional</small></span>
            <textarea id="folder-description" name="description" defaultValue={folder?.description ?? ""} rows={4} maxLength={2000} />
          </label>
          <div className="service-field">
            <span>Parent folder <small>optional</small></span>
            <AnimatedSelect name="parent_id" label="Parent folder" menuLabel="Parent folders" value={parentId} onChange={setParentId} options={[{ value: "", label: "Root" }, ...folders.filter((candidate) => candidate.id !== folder?.id).map((candidate) => ({ value: candidate.id, label: candidate.name }))]} />
          </div>
          <label className="service-field" htmlFor="folder-sort-order">
            <span>Sort order</span>
            <input id="folder-sort-order" name="sort_order" type="number" min="0" step="1" defaultValue={folder?.sort_order ?? 0} required />
          </label>
          <div className="service-field service-field-wide">
            <span>Image <small>unavailable</small></span>
            <button className="service-disabled-control" type="button" disabled>Image upload is not configured</button>
            <small className="service-field-help">Folder images can be connected after the media domain exists.</small>
          </div>
        </div>
      </section>
      <div className="service-form-actions">
        <Link className="button-secondary" href="/services">Cancel</Link>
        <SubmitButton editing={Boolean(folder)} />
      </div>
    </form>
  );
}
