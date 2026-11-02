"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createServiceFolderAction, type CatalogFormState } from "../../app/actions/services";
import { SheetFrame } from "../ui/mobile-filter-sheet";
import styles from "./services-root-actions.module.css";

function CreateFolderSubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit" className="button-primary" aria-busy={pending || undefined} disabled={pending}>
    {pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}
    Create Folder
  </button>;
}

/** The shared dialog portals beyond the animated page and owns focus/scroll restoration. */
export function ServicesRootActions() {
  const [open, setOpen] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [state, action] = useActionState(createServiceFolderAction, { error: null } as CatalogFormState);
  return <div className="services-header-actions">
    <button type="button" className="button-primary" onClick={() => setOpen(true)}>
      <Plus aria-hidden="true" />New Folder
    </button>
    <SheetFrame open={open} onClose={() => setOpen(false)} label="Create a service folder" eyebrow="New folder" closeLabel="Close">
      <form action={action}>
        <input type="hidden" name="request_id" value={requestId} />
        <input type="hidden" name="sort_order" value="0" />
        <div className={styles.dialogBody}>
          {state.error ? <p className={styles.dialogError} role="alert">{state.error}</p> : null}
          <label><span>Folder name</span><input name="name" maxLength={200} required data-autofocus placeholder="Ecommerce SEO" /></label>
        </div>
        <footer className={styles.dialogActions}>
          <button type="button" className="button-secondary" onClick={() => setOpen(false)}>Cancel</button>
          <CreateFolderSubmitButton />
        </footer>
      </form>
    </SheetFrame>
  </div>;
}