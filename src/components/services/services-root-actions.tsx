"use client";

import { Folder, MoreHorizontal, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useActionState } from "react";
import { createServiceFolderAction, type CatalogFormState } from "../../app/actions/services";
import { useAnimatedPopover } from "../ui/use-animated-popover";
import styles from "./services-root-actions.module.css";

/**
 * Root Services header actions.
 *
 * The primary action is now folder creation (`+ New Folder`), opened as a
 * minimal modal that reuses the existing `createServiceFolderAction` — so a new
 * folder lands in the real `service_folders` model and the existing carousel
 * picks it up on the next load. `+ New Service` no longer lives on the root;
 * it lives inside a folder. The Actions menu is preserved for the detailed
 * folder form page.
 */
export function ServicesRootActions() {
  const { render, phase, show, hide } = useAnimatedPopover(160);
  const [requestId] = useState(() => crypto.randomUUID());
  const initialState: CatalogFormState = { error: null };
  const [state, action] = useActionState(createServiceFolderAction, initialState);

  useEffect(() => {
    if (!render) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") hide();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [render, hide]);

  return (
    <div className="services-header-actions">
      <button
        type="button"
        className="button-primary"
        onClick={show}
      >
        <Plus aria-hidden="true" />
        New Folder
      </button>

      <details className="services-actions-menu">
        <summary className="button-secondary">
          <MoreHorizontal aria-hidden="true" />
          Actions
        </summary>

        <div>
          <Link href="/services/folders/new">
            <Folder aria-hidden="true" />
            New Folder
          </Link>
        </div>
      </details>

      {render ? (
        <div className={styles.modalLayer}>
          <button
            type="button"
            className={`${styles.modalBackdrop} ${
              phase === "open"
                ? styles.modalBackdropOpen
                : styles.modalBackdropClosing
            }`}
            aria-label="Close"
            onClick={hide}
          />

          <form
            action={action}
            className={`${styles.dialog} ${
              phase === "open" ? styles.dialogOpen : styles.dialogClosing
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="folder-create-title"
          >
            <input type="hidden" name="request_id" value={requestId} />
            <input type="hidden" name="sort_order" value="0" />

            <header className={styles.dialogHeader}>
              <div>
                <span>New folder</span>
                <h2 id="folder-create-title">Create a service folder</h2>
              </div>

              <button
                type="button"
                aria-label="Close"
                onClick={hide}
              >
                <X aria-hidden="true" />
              </button>
            </header>

            <div className={styles.dialogBody}>
              {state.error ? (
                <p className={styles.dialogError} role="alert">
                  {state.error}
                </p>
              ) : null}

              <label>
                <span>Folder name</span>
                <input
                  name="name"
                  maxLength={200}
                  required
                  autoFocus
                  placeholder="Ecommerce SEO"
                />
              </label>
            </div>

            <footer className={styles.dialogActions}>
              <button
                type="button"
                className="button-secondary"
                onClick={hide}
              >
                Cancel
              </button>

              <button type="submit" className="button-primary">
                Create Folder
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>
  );
}
