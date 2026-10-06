"use client";

import { LoaderCircle, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { addCompanyPersonAction, updateCompanyAction } from "../../app/actions/companies";
import { RowActionMenu } from "../ui/row-action-menu";
import { SearchableSelect, type SearchableOption } from "../ui/searchable-select";
import { useAnimatedPopover } from "../ui/use-animated-popover";
import styles from "./company-experience.module.css";

type DialogKind = "person" | "company" | null;

/** `company` renders the record's ellipsis menu (Edit company); `person` renders the People section's Add person button. */
export function CompanyActions({
  kind,
  companyId,
  companyName,
  people = [],
}: {
  kind: Exclude<DialogKind, null>;
  companyId: string;
  companyName: string;
  /** Existing people that can be added to this Company. */
  people?: SearchableOption[];
}) {
  const router = useRouter();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [personId, setPersonId] = useState("");
  const [pending, startTransition] = useTransition();
  const { render, phase, show, hide } = useAnimatedPopover(130);

  const close = useCallback(() => {
    if (pending) return;
    hide();
    setError(null);
    window.setTimeout(() => triggerRef.current?.focus(), 130);
  }, [pending, hide]);

  function open(kind: Exclude<DialogKind, null>, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setDialog(kind);
    setError(null);
    setPersonId("");
    show();
  }

  useEffect(() => {
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (firstFieldRef.current ?? dialogRef.current?.querySelector<HTMLInputElement>("input"))?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) close();
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href]") ?? []);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dialog, pending, render, close]);

  function finish(result: { ok: boolean; error?: string }) {
    if (!result.ok) {
      setError(result.error ?? "The change could not be saved.");
      return;
    }
    hide();
    setError(null);
    router.refresh();
  }

  function submitCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => finish(await updateCompanyAction(companyId, String(data.get("name") ?? ""))));
  }

  function submitPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!personId) {
      setError("Choose a person.");
      return;
    }
    startTransition(async () => finish(await addCompanyPersonAction(companyId, personId)));
  }

  const modal = render && dialog ? (
    <div className={`${styles.backdrop} ${phase === "closing" ? styles.backdropClosing : ""}`} onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section ref={dialogRef} className={`${styles.dialog} ${phase === "closing" ? styles.dialogClosing : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className={styles.dialogHeader}>
          <div>
            <h2 id={titleId}>{dialog === "person" ? "Add person" : "Edit company"}</h2>
            <p>{dialog === "person" ? `Add an existing person to ${companyName}. Their Client record does not change.` : "Update the Company name."}</p>
          </div>
          <button type="button" aria-label="Close dialog" onClick={close} disabled={pending}><X aria-hidden="true" /></button>
        </header>

        <form className={styles.dialogForm} onSubmit={dialog === "person" ? submitPerson : submitCompany}>
          {dialog === "person" ? (
            <SearchableSelect
              label="Person"
              menuLabel="Choose a person"
              placeholder="Search people"
              emptyMessage={people.length ? "No matching people." : "Everyone is already in this Company."}
              options={people}
              value={personId}
              onChange={setPersonId}
              disabled={pending}
              required
            />
          ) : (
            <label>
              <span>Company name</span>
              <input ref={firstFieldRef} name="name" defaultValue={companyName} maxLength={200} required disabled={pending} autoComplete="organization" />
            </label>
          )}
          {error ? <p className={styles.dialogError} role="alert">{error}</p> : null}
          <footer className={styles.dialogFooter}>
            <button type="button" className={styles.secondaryButton} onClick={close} disabled={pending}>Cancel</button>
            <button type="submit" className={styles.primaryButton} disabled={pending} aria-busy={pending || undefined}>
              {pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}
              {pending ? "Saving" : dialog === "person" ? "Add person" : "Save company"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  ) : null;

  return (
    <>
      {kind === "person"
        ? <button type="button" className={styles.sectionAction} onClick={(event) => open("person", event.currentTarget)}><Plus aria-hidden="true" />Add person</button>
        : <RowActionMenu name={companyName} items={[{ label: "Edit company", onSelect: (trigger) => open("company", trigger) }]} />}
      {typeof document !== "undefined" && modal ? createPortal(modal, document.body) : null}
    </>
  );
}
