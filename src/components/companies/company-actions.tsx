"use client";

import { Building2, LoaderCircle, UserRoundPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { addCompanyPersonAction, updateCompanyAction } from "../../app/actions/companies";
import { useAnimatedPopover } from "../ui/use-animated-popover";
import styles from "./company-experience.module.css";

type DialogKind = "person" | "company" | null;

export function CompanyActions({
  companyId,
  companyName,
  canAddPerson,
  canEdit,
}: {
  companyId: string;
  companyName: string;
  canAddPerson: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [error, setError] = useState<string | null>(null);
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
    show();
  }

  useEffect(() => {
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    firstFieldRef.current?.focus();
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
    const data = new FormData(event.currentTarget);
    startTransition(async () => finish(await addCompanyPersonAction(companyId, {
      requestId: crypto.randomUUID(),
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      phone: String(data.get("phone") ?? ""),
      jobTitle: String(data.get("job_title") ?? ""),
    })));
  }

  const modal = render && dialog ? (
    <div className={`${styles.backdrop} ${phase === "closing" ? styles.backdropClosing : ""}`} onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section ref={dialogRef} className={`${styles.dialog} ${phase === "closing" ? styles.dialogClosing : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className={styles.dialogHeader}>
          <div>
            <h2 id={titleId}>{dialog === "person" ? "Add person" : "Edit company"}</h2>
            <p>{dialog === "person" ? `Link a person to ${companyName} without creating portal credentials.` : "Update the business entity name."}</p>
          </div>
          <button type="button" aria-label="Close dialog" onClick={close} disabled={pending}><X aria-hidden="true" /></button>
        </header>

        <form className={styles.dialogForm} onSubmit={dialog === "person" ? submitPerson : submitCompany}>
          <label>
            <span>{dialog === "person" ? "Name" : "Company name"}</span>
            <input ref={firstFieldRef} name="name" defaultValue={dialog === "company" ? companyName : ""} maxLength={200} required disabled={pending} autoComplete={dialog === "company" ? "organization" : "name"} />
          </label>
          {dialog === "person" ? (
            <>
              <label><span>Email <small>optional</small></span><input name="email" type="email" maxLength={320} autoComplete="email" disabled={pending} /></label>
              <div className={styles.fieldGrid}>
                <label><span>Phone <small>optional</small></span><input name="phone" type="tel" maxLength={50} autoComplete="tel" disabled={pending} /></label>
                <label><span>Job title <small>optional</small></span><input name="job_title" maxLength={120} autoComplete="organization-title" disabled={pending} /></label>
              </div>
              <p className={styles.portalNote}>Portal access stays off. Provisioning a login remains a separate action.</p>
            </>
          ) : null}
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
    <div className={styles.headerActions}>
      {canAddPerson ? <button type="button" className={styles.primaryButton} onClick={(event) => open("person", event.currentTarget)}><UserRoundPlus aria-hidden="true" />Add person</button> : null}
      {canEdit ? <button type="button" className={styles.secondaryButton} onClick={(event) => open("company", event.currentTarget)}><Building2 aria-hidden="true" />Edit company</button> : null}
      {typeof document !== "undefined" && modal ? createPortal(modal, document.body) : null}
    </div>
  );
}
