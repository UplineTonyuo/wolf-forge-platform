"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getWhiteLabelDraftAction, saveWhiteLabelDraftAction } from "../../app/actions/white-label";
import {
  draftModuleKeys,
  draftProblem,
  type WhiteLabelDraft,
  type WhiteLabelTenant,
} from "../../domain/white-label/draft";
import type { WhiteLabelPreviewState } from "../../domain/white-label/preview";
import { AnimatedSelect } from "../ui/animated-select";
import { WhiteLabelBuilder } from "./white-label-builder";
import { WhiteLabelDraftReview } from "./white-label-draft-review";
import styles from "./white-label-builder.module.css";

type Status =
  | { kind: "idle" | "loading" | "saving" }
  | { kind: "saved"; revision: number }
  | { kind: "invalid" | "denied"; message: string }
  | { kind: "conflict" }
  | { kind: "failed"; retry: "load" | "save" };

/** Comparable form of a draft: what the server would store. */
function persisted(state: WhiteLabelPreviewState): string {
  return JSON.stringify([state.displayName.trim(), state.primaryColor, state.accentColor, draftModuleKeys(state.modules)]);
}

const STATUS_LABEL: Record<string, string> = { active: "Active", suspended: "Suspended", archived: "Archived" };

/**
 * WL-2.33: Platform Admin draft builder for one explicitly chosen Tenant.
 * Saving writes a DRAFT only; nothing is published or enforced. Every load and
 * save is a server action that re-checks the Platform Admin entitlement.
 */
export function WhiteLabelDraftEditor({
  tenants: initialTenants,
  initialDraft,
}: {
  tenants: WhiteLabelTenant[];
  initialDraft: WhiteLabelDraft | null;
}) {
  const [tenants, setTenants] = useState(initialTenants);
  const [tenantId, setTenantId] = useState(initialDraft?.tenantId ?? "");
  const [draft, setDraft] = useState(initialDraft);
  const [state, setState] = useState(initialDraft?.state ?? null);
  const [colorsValid, setColorsValid] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pendingTenantId, setPendingTenantId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const keepEditingButton = useRef<HTMLButtonElement>(null);
  const departureLink = useRef<HTMLElement | null>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const restoreReviewFocus = useRef(false);
  useEffect(() => {
    if (!reviewing && restoreReviewFocus.current) {
      reviewButton.current?.focus();
      restoreReviewFocus.current = false;
    }
  }, [reviewing]);
  // Only the newest load may update the screen (a slow Tenant A response
  // must not land after the user switched to Tenant B).
  const latestLoad = useRef(0);
  const saveInFlight = useRef(false);
  const pendingSave = useRef<{ tenantId: string; expectedRevision: number; state: WhiteLabelPreviewState } | null>(null);

  const tenant = tenants.find((entry) => entry.id === tenantId);
  const pendingTenant = tenants.find((entry) => entry.id === pendingTenantId);
  const uncertain = status.kind === "failed" && status.retry === "save";
  const dirty = Boolean(draft && state && (persisted(state) !== persisted(draft.state) || !colorsValid || uncertain));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const guard = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const drawer = link.closest("dialog");
      if (drawer?.open) {
        drawer.close();
        departureLink.current = document.querySelector<HTMLElement>('[aria-controls="mobile-navigation"]') ?? link;
      } else departureLink.current = link;
      setPendingHref(`${destination.pathname}${destination.search}${destination.hash}`);
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guard, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guard, true);
    };
  }, [dirty]);
  function cancelDeparture() {
    setPendingHref(null);
    departureLink.current?.focus();
  }
  useEffect(() => { if (pendingHref) keepEditingButton.current?.focus(); }, [pendingHref]);
  const busy = status.kind === "loading" || status.kind === "saving";
  const readOnly = draft?.tenantStatus !== "active";
  const canSave = Boolean(draft && state && dirty && colorsValid && !readOnly && !busy && !pendingTenantId && !pendingHref && status.kind !== "conflict" && status.kind !== "denied");

  async function load(nextTenantId: string) {
    const request = ++latestLoad.current;
    setPendingTenantId(null);
    setReviewing(false);
    setColorsValid(true);
    pendingSave.current = null;
    setTenantId(nextTenantId);
    setDraft(null);
    setState(null);
    setStatus({ kind: "loading" });
    window.history.replaceState(null, "", `?tenant=${encodeURIComponent(nextTenantId)}`);
    // A transport failure (null) is retryable, like a server failure.
    const result = await getWhiteLabelDraftAction(nextTenantId).catch(() => null);
    if (request !== latestLoad.current) return;
    if (result?.ok) {
      setDraft(result.data);
      setState(result.data.state);
      setStatus({ kind: "idle" });
    } else if (result?.error.code === "PERMISSION_DENIED" || result?.error.code === "NOT_FOUND") {
      setStatus({ kind: "denied", message: "This Tenant's draft is not available to you." });
    } else {
      setStatus({ kind: "failed", retry: "load" });
    }
  }

  function chooseTenant(nextTenantId: string) {
    if (nextTenantId === tenantId) return;
    if (dirty) setPendingTenantId(nextTenantId);
    else void load(nextTenantId);
  }

  async function save() {
    if (saveInFlight.current || !draft || !state || readOnly || status.kind === "conflict" || status.kind === "denied" || (!pendingSave.current && !colorsValid)) return;
    const saved = pendingSave.current?.state ?? { ...state, displayName: state.displayName.trim(), modules: { ...state.modules } };
    const problem = draftProblem(saved);
    if (problem) {
      setStatus({ kind: "invalid", message: problem });
      return;
    }
    const snapshot = pendingSave.current ?? { tenantId: draft.tenantId, expectedRevision: draft.revision, state: saved };
    pendingSave.current = snapshot;
    const generation = latestLoad.current;
    saveInFlight.current = true;
    setStatus({ kind: "saving" });
    const result = await saveWhiteLabelDraftAction({
      tenantId: snapshot.tenantId,
      expectedRevision: snapshot.expectedRevision,
      displayName: saved.displayName,
      primaryColor: saved.primaryColor,
      accentColor: saved.accentColor,
      moduleKeys: draftModuleKeys(saved.modules),
    }).catch(() => null);
    saveInFlight.current = false;
    if (generation !== latestLoad.current) return;
    // null = the response was lost; the write may have landed. Retrying the identical
    // save is safe: the server answers an exact replay as already applied.
    if (result?.ok) {
      pendingSave.current = null;
      // Only now, after the server confirmed the write, is the draft "saved".
      setDraft({ ...draft, state: saved, revision: result.data.revision, updatedAt: result.data.updatedAt });
      setState((current) => current && persisted(current) !== persisted(saved) ? current : saved);
      setTenants((current) =>
        current.map((entry) => (entry.id === draft.tenantId ? { ...entry, draftRevision: result.data.revision } : entry)),
      );
      setStatus({ kind: "saved", revision: result.data.revision });
    } else if (result?.error.code === "CONFLICT") {
      pendingSave.current = null;
      setStatus({ kind: "conflict" });
    } else if (result?.error.code === "VALIDATION_ERROR" || result?.error.code === "PERMISSION_DENIED") {
      pendingSave.current = null;
      setStatus({ kind: result.error.code === "PERMISSION_DENIED" ? "denied" : "invalid", message: result.error.message });
    } else {
      setStatus({ kind: "failed", retry: "save" });
    }
  }

  const revisionLabel = !draft ? "" : draft.revision === 0 ? "No draft saved yet · defaults" : `Draft revision ${draft.revision}`;

  return (
    <div className={styles.editor}>
      <header className={styles.studioHeader}>
        <h1>White Label Studio</h1>
        <p>Draft only. Save your Tenant&apos;s identity and module choices without changing its live workspace.</p>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.tenantPicker}>
          <span className={styles.toolbarLabel}>Tenant</span>
          <AnimatedSelect
            name="tenant"
            label="Tenant"
            menuLabel="Tenants"
            value={tenantId}
            disabled={status.kind === "saving"}
            onChange={chooseTenant}
            options={tenants.map((entry) => ({
              value: entry.id,
              label: entry.displayName,
              description: `${entry.slug} · ${STATUS_LABEL[entry.status] ?? entry.status} · ${
                entry.draftRevision ? `draft revision ${entry.draftRevision}` : "no draft"
              }`,
            }))}
          />
        </div>
        <div className={styles.toolbarActions}>
          <span className={styles.draftMeta} data-testid="draft-revision">
            {dirty ? <strong className={styles.dirty}>Unsaved changes</strong> : null}
            {draft && !dirty ? <strong>{draft.revision ? "All changes saved" : "Loaded defaults"}</strong> : null}
            {revisionLabel}
            {status.kind === "saving" ? <span>Saving draft…</span> : status.kind === "conflict" ? <strong className={styles.dirty}>Revision conflict</strong> : uncertain ? <strong className={styles.dirty}>Save failed · confirmation pending</strong> : null}
          </span>
          <button
            ref={reviewButton}
            type="button"
            className="button-secondary"
            disabled={!draft || !state || !colorsValid || busy || reviewing || Boolean(pendingTenantId) || Boolean(pendingHref)}
            onClick={() => setReviewing(true)}
          >
            Review Draft
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={!canSave}
            aria-busy={status.kind === "saving" || undefined}
            onClick={() => void save()}
          >
            {status.kind === "saving" ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}
            {status.kind === "saving" ? "Saving…" : "Save Draft"}
          </button>
        </div>
      </div>

      <div className={styles.statusRegion} role="status" aria-live="polite">
        {pendingHref ? (
          <div className={styles.notice} onKeyDown={(event) => { if (event.key === "Escape") cancelDeparture(); }}>
            <p>You have unsaved draft changes. Leaving this studio discards them.</p>
            <div className={styles.noticeActions}>
              <button ref={keepEditingButton} type="button" className="button-secondary" onClick={cancelDeparture}>Keep editing</button>
              <button type="button" className="button-primary" disabled={busy} onClick={() => router.push(pendingHref)}>Discard and leave</button>
            </div>
          </div>
        ) : pendingTenant && tenant ? (
          <div className={styles.notice}>
            <p>
              You have unsaved changes to {tenant.displayName}. Switching to {pendingTenant.displayName} discards them.
            </p>
            <div className={styles.noticeActions}>
              <button type="button" className="button-secondary" onClick={() => setPendingTenantId(null)}>
                Keep editing
              </button>
              <button type="button" className="button-primary" onClick={() => void load(pendingTenant.id)}>
                Discard and switch
              </button>
            </div>
          </div>
        ) : status.kind === "loading" ? (
          <p className={styles.info}>Loading {tenant?.displayName ?? "Tenant"}…</p>
        ) : status.kind === "saved" ? (
          <p className={styles.success}>Draft saved · revision {status.revision}. Nothing was published.{dirty ? " You have newer unsaved changes." : ""}</p>
        ) : status.kind === "invalid" || status.kind === "denied" ? (
          <p className={styles.error}>{status.message}</p>
        ) : status.kind === "conflict" ? (
          <div className={styles.notice}>
            <p>Someone else saved this Tenant&apos;s draft after you opened it. Your changes were not saved.</p>
            <div className={styles.noticeActions}>
              <button type="button" className="button-secondary" onClick={() => void load(tenantId)}>
                Load latest (discards your changes)
              </button>
            </div>
          </div>
        ) : status.kind === "failed" ? (
          <div className={styles.notice}>
            <p>
              {status.retry === "save"
                ? "The draft could not be saved. Your changes are still here."
                : "The draft could not be loaded."}
              {status.retry === "save" ? " Retry confirms the original save before sending any newer edits." : ""}
            </p>
            <div className={styles.noticeActions}>
              <button
                type="button"
                className="button-secondary"
                onClick={() => void (status.retry === "save" ? save() : load(tenantId))}
              >
                Try again
              </button>
            </div>
          </div>
        ) : draft && readOnly ? (
          <p className={styles.info}>This Tenant is {STATUS_LABEL[draft.tenantStatus]?.toLowerCase()}, so its draft is read-only.</p>
        ) : null}
      </div>

      {draft && state ? (
        <WhiteLabelBuilder
          key={draft.tenantId}
          state={state}
          onStateChange={(update) => {
            setState((current) => (current ? (typeof update === "function" ? update(current) : update) : current));
            if (status.kind === "saved" || status.kind === "invalid") setStatus({ kind: "idle" });
          }}
          readOnly={readOnly || status.kind === "saving" || status.kind === "denied"}
          onColorValidityChange={setColorsValid}
          tenantName={tenant?.displayName}
          controls={reviewing ? <WhiteLabelDraftReview
            draft={draft}
            state={state}
            hasChanges={dirty}
            busy={busy}
            onSave={() => void save()}
            canSave={canSave}
            onBack={() => {
              restoreReviewFocus.current = true;
              setReviewing(false);
            }}
          /> : undefined}
        />
      ) : status.kind !== "loading" && !tenantId ? (
        <div className={styles.emptyState}>
          <strong>Choose a Tenant</strong>
          <p>Pick the Tenant whose White Label draft you want to edit. Nothing is saved until you choose Save Draft.</p>
        </div>
      ) : null}
    </div>
  );
}
