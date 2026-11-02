"use client";

import { useRouteTransitionPush } from "../shell/route-transition";

import { ArrowLeft, ClipboardCheck, LayoutList, LoaderCircle, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getWhiteLabelDraftAction, listWhiteLabelDraftsAction, saveWhiteLabelDraftAction } from "../../app/actions/white-label";
import {
  draftModuleKeys,
  draftProblem,
  type WhiteLabelDraft,
  type WhiteLabelDraftSummary,
  type WhiteLabelTenant,
} from "../../domain/white-label/draft";
import type { WhiteLabelPreviewState } from "../../domain/white-label/preview";
import { PortalDialog } from "../account/ui/portal-dialog";
import { WhiteLabelDraftList } from "./white-label-draft-list";
import { WhiteLabelBuilder } from "./white-label-builder";
import { WhiteLabelDraftReview } from "./white-label-draft-review";
import { WhiteLabelPublicationControls } from "./white-label-publication-controls";
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
function nativeHistoryIndex(): number | undefined {
  const navigation = (window as Window & {navigation?: {currentEntry?: {index: number}}}).navigation;
  const index = navigation?.currentEntry?.index;
  return index !== undefined && index >= 0 ? index : undefined;
}

/**
 * WL-2.33: Platform Admin draft builder for one explicitly chosen Tenant.
 * Saving writes a DRAFT only; nothing is published or enforced. Every load and
 * save is a server action that re-checks the Platform Admin entitlement.
 */
export function WhiteLabelDraftEditor({
  tenants: initialTenants,
  initialDraft,
  actorId,
}: {
  tenants: WhiteLabelTenant[];
  initialDraft: WhiteLabelDraft | null;
  actorId?: string;
}) {
  const [tenants, setTenants] = useState(initialTenants);
  const [tenantId, setTenantId] = useState(initialDraft?.tenantId ?? "");
  const [draft, setDraft] = useState(initialDraft);
  const [state, setState] = useState(initialDraft?.state ?? null);
  const [colorsValid, setColorsValid] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pendingTenantId, setPendingTenantId] = useState<string | null>(null);
  const [pendingReturn, setPendingReturn] = useState(false);
  const [summaries, setSummaries] = useState<WhiteLabelDraftSummary[]>([]);
  const [listStatus, setListStatus] = useState<"loading" | "ready" | "denied" | "failed">("loading");
  const latestList = useRef(0);
  const historyIndex = useRef(0);
  const suppressPop = useRef(false);
  const allowPop = useRef(false);
  const pendingHistoryDelta = useRef<number | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const push = useRouteTransitionPush();
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

  const refreshList = useCallback(async () => {
    const request = ++latestList.current;
    setListStatus("loading");
    const result = await listWhiteLabelDraftsAction().catch(() => null);
    if (request !== latestList.current) return;
    if (result?.ok) {
      setSummaries(result.data);
      setTenants(result.data.map(({tenant, draft}) => ({...tenant, draftRevision: draft.revision || null})));
      setListStatus("ready");
    } else {
      setSummaries([]);
      const denied = result?.error.code === "PERMISSION_DENIED" || result?.error.code === "NOT_FOUND";
      setListStatus(denied ? "denied" : "failed");
      if (denied) { ++latestLoad.current; pendingSave.current = null; setDraft(null); setState(null); setStatus({kind:"denied",message:"Tenant drafts are not available to your current session."}); }
    }
  }, []);
  const invalidateRequests = useCallback(() => { ++latestList.current; ++latestLoad.current; }, []);
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => { if (mounted) void refreshList(); });
    const index = window.history.state?.wfStudioIndex;
    historyIndex.current = nativeHistoryIndex() ?? (Number.isInteger(index) ? index : 0);
    window.history.replaceState({...window.history.state, wfStudioIndex: historyIndex.current}, "", window.location.href);
    return () => { mounted = false; invalidateRequests(); };
  }, [refreshList, invalidateRequests]);

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
    pendingHistoryDelta.current = null;
    setPendingHref(null);
    departureLink.current?.focus();
  }
  function completeDeparture() {
    const delta = pendingHistoryDelta.current;
    pendingHistoryDelta.current = null;
    if (delta !== null) { allowPop.current = true; setPendingHref(null); window.history.go(delta); }
    else if (pendingHref) push(pendingHref);
  }
  useEffect(() => { if (pendingHref) keepEditingButton.current?.focus(); }, [pendingHref]);
  const busy = status.kind === "loading" || status.kind === "saving";
  const readOnly = draft?.tenantStatus !== "active";
  const canSave = Boolean(draft && state && dirty && colorsValid && !readOnly && !busy && !pendingTenantId && !pendingReturn && !pendingHref && status.kind !== "conflict" && status.kind !== "denied");

  const load = useCallback(async (nextTenantId: string, navigation: "push" | "none" = "push") => {
    const request = ++latestLoad.current;
    setPendingTenantId(null);
    setPendingReturn(false);
    setReviewing(false);
    setColorsValid(true);
    pendingSave.current = null;
    setTenantId(nextTenantId);
    setDraft(null);
    setState(null);
    if (navigation === "push") {
      historyIndex.current = nativeHistoryIndex() ?? historyIndex.current;
      ++historyIndex.current;
      window.history.pushState({...window.history.state,wfStudioIndex:historyIndex.current}, "", nextTenantId ? `/white-label?tenant=${encodeURIComponent(nextTenantId)}` : "/white-label");
    }
    if (!nextTenantId) { setStatus({kind:"idle"}); void refreshList(); return; }
    if (!tenants.some((entry) => entry.id === nextTenantId)) { setStatus({kind:"denied",message:"This Tenant's draft is not available to you."}); return; }
    setStatus({ kind: "loading" });
    // A transport failure (null) is retryable, like a server failure.
    const result = await getWhiteLabelDraftAction(nextTenantId).catch(() => null);
    if (request !== latestLoad.current) return;
    if (result?.ok) {
      setDraft(result.data);
      setState(result.data.state);
      setSummaries((current) => current.map((entry) => entry.tenant.id === nextTenantId ? {...entry,draft:result.data} : entry));
      setStatus({ kind: "idle" });
    } else if (result?.error.code === "PERMISSION_DENIED" || result?.error.code === "NOT_FOUND") {
      setStatus({ kind: "denied", message: "This Tenant's draft is not available to you." });
    } else {
      setStatus({ kind: "failed", retry: "load" });
    }
  }, [refreshList, tenants]);

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      if (suppressPop.current) { suppressPop.current = false; return; }
      const requested = new URLSearchParams(window.location.search).getAll("tenant");
      const nextTenant = requested.length === 1 ? requested[0] ?? "" : "";
      const nextIndex = nativeHistoryIndex() ?? (Number.isInteger(window.history.state?.wfStudioIndex) ? window.history.state.wfStudioIndex : historyIndex.current - 1);
      if (window.location.pathname === "/white-label" && nextTenant === tenantId) {
        historyIndex.current = nextIndex;
        return;
      }
      const delta = nextIndex - historyIndex.current;
      if (dirty && !allowPop.current && delta !== 0) {
        event.stopImmediatePropagation();
        pendingHistoryDelta.current = delta;
        suppressPop.current = true;
        const href = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.history.go(-delta);
        if (window.location.pathname !== "/white-label") setPendingHref(href);
        else if (nextTenant) setPendingTenantId(nextTenant); else setPendingReturn(true);
        return;
      }
      allowPop.current = false;
      historyIndex.current = nextIndex;
      if (window.location.pathname !== "/white-label") return;
      void load(nextTenant, "none");
    };
    window.addEventListener("popstate", onPop, true);
    return () => window.removeEventListener("popstate", onPop, true);
  }, [dirty, load, tenantId]);

  function chooseTenant(nextTenantId: string) {
    if (nextTenantId === tenantId) return;
    if (dirty) setPendingTenantId(nextTenantId);
    else void load(nextTenantId);
  }

  function returnToDrafts() {
    if (dirty) setPendingReturn(true);
    else void load("");
  }
  function cancelSwitch() {
    if (saveInFlight.current) return;
    pendingHistoryDelta.current = null;
    setPendingTenantId(null);
    setPendingReturn(false);
  }
  function completeSwitch() {
    const delta = pendingHistoryDelta.current;
    pendingHistoryDelta.current = null;
    if (delta !== null) {
      allowPop.current = true;
      setPendingTenantId(null); setPendingReturn(false);
      window.history.go(delta);
    } else void load(pendingReturn ? "" : pendingTenantId ?? "");
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
      const confirmed = { ...draft, state: saved, revision: result.data.revision, updatedAt: result.data.updatedAt };
      setDraft(confirmed);
      ++latestList.current;
      setListStatus("ready");
      setSummaries((current) => current.map((entry) => entry.tenant.id === snapshot.tenantId ? {...entry,draft:confirmed} : entry));
      setState((current) => current && persisted(current) !== persisted(saved) ? current : saved);
      setTenants((current) =>
        current.map((entry) => (entry.id === draft.tenantId ? { ...entry, draftRevision: result.data.revision } : entry)),
      );
      setStatus({ kind: "saved", revision: result.data.revision });
      return persisted(state) === persisted(saved) && colorsValid;
    } else if (result?.error.code === "CONFLICT") {
      pendingSave.current = null;
      setStatus({ kind: "conflict" });
    } else if (result?.error.code === "VALIDATION_ERROR" || result?.error.code === "PERMISSION_DENIED") {
      pendingSave.current = null;
      setStatus({ kind: result.error.code === "PERMISSION_DENIED" ? "denied" : "invalid", message: result.error.message });
    } else {
      setStatus({ kind: "failed", retry: "save" });
    }
    return false;
  }

  const revisionLabel = !draft ? "" : draft.revision === 0 ? "No draft saved yet · defaults" : `Draft revision ${draft.revision}`;

  return (
    // The shared page frame gives White Label the same width, gutters and header rule as other feature pages.
    <div className={`page-frame ${styles.editor}`}>
      <header className={`page-header ${styles.studioHeader}`}>
        {tenantId ? <button type="button" className={styles.backButton} aria-label="Back to All Drafts" title="Back to All Drafts" disabled={status.kind === "saving"} onClick={returnToDrafts}><ArrowLeft aria-hidden="true" /></button> : null}
        <div>
          <h1 id="main-heading" tabIndex={-1}>White Label Studio</h1>
          <p>{tenantId
            ? <>Editing <strong data-testid="studio-tenant">{tenant?.displayName ?? "Tenant"}</strong>{tenant ? ` · ${tenant.slug} · ${STATUS_LABEL[tenant.status] ?? tenant.status}` : ""}. Saving updates the draft only; live workspaces stay unchanged.</>
            : "Choose a Tenant draft to continue. Saving updates drafts only; live workspaces stay unchanged."}</p>
        </div>
      </header>

      <PortalDialog open={pendingReturn || Boolean(pendingTenantId)} onClose={cancelSwitch} title="Unsaved draft changes" initialFocusRef={keepEditingButton} closeOnBackdrop={false}
        footer={<div className={styles.noticeActions}>
          <button ref={keepEditingButton} type="button" className="button-secondary" disabled={busy} onClick={cancelSwitch}>Keep editing</button>
          <button type="button" className="button-secondary" disabled={busy} onClick={completeSwitch}>{pendingReturn ? "Discard and return" : "Discard and switch"}</button>
          <button type="button" className="button-primary" disabled={busy || !colorsValid || readOnly || status.kind === "conflict" || status.kind === "denied"} onClick={async () => { if (await save()) completeSwitch(); }}>Save Draft, then {pendingReturn ? "return" : "switch"}</button>
        </div>}>
        <p>You have unsaved changes to {tenant?.displayName ?? "this Tenant"}. {pendingReturn ? "Return to All Drafts" : `Switch to ${pendingTenant?.displayName ?? "the requested Tenant"}`} after saving, or discard only your local edits.</p>
        {status.kind === "failed" || status.kind === "conflict" || status.kind === "invalid" || status.kind === "denied" ? <p role="alert">{status.kind === "conflict" ? "Revision conflict. Keep editing and load the latest draft before saving." : status.kind === "failed" ? "Save was not confirmed. Your edits remain here; retry confirms the original save first." : status.message}</p> : null}
        {status.kind === "saved" && dirty ? <p role="status">The original save is confirmed. Save again to include your newer edits before returning.</p> : null}
      </PortalDialog>

      <div className={styles.statusRegion} role="status" aria-live="polite">
        {pendingHref ? (
          <div className={styles.notice} onKeyDown={(event) => { if (event.key === "Escape") cancelDeparture(); }}>
            <p>You have unsaved draft changes. Leaving this studio discards them.</p>
            <div className={styles.noticeActions}>
              <button ref={keepEditingButton} type="button" className="button-secondary" onClick={cancelDeparture}>Keep editing</button>
              <button type="button" className="button-primary" disabled={busy} onClick={completeDeparture}>Discard and leave</button>
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
          actions={<>
            <button
              type="button"
              className={`button-primary ${styles.saveButton}`}
              disabled={!canSave}
              aria-busy={status.kind === "saving" || undefined}
              onClick={() => void save()}
            >
              {status.kind === "saving" ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}
              {status.kind === "saving" ? "Saving…" : "Save Draft"}
            </button>
            <button
              ref={reviewButton}
              type="button"
              className="button-secondary"
              disabled={!draft || !state || !colorsValid || busy || reviewing || Boolean(pendingTenantId) || Boolean(pendingHref)}
              onClick={() => setReviewing(true)}
            >
              <ClipboardCheck aria-hidden="true" />Review Draft
            </button>
            <button type="button" className="button-secondary" disabled={busy} onClick={returnToDrafts}><LayoutList aria-hidden="true" />All Drafts</button>
            <span className={styles.draftMeta} data-testid="draft-revision">
              {dirty ? <strong className={styles.dirty}>Unsaved changes</strong> : null}
              {draft && !dirty ? <strong>{draft.revision ? "All changes saved" : "Loaded defaults"}</strong> : null}
              {revisionLabel}
              {status.kind === "saving" ? <span>Saving draft…</span> : status.kind === "conflict" ? <strong className={styles.dirty}>Revision conflict</strong> : uncertain ? <strong className={styles.dirty}>Save failed · confirmation pending</strong> : null}
            </span>
          </>}
          controls={reviewing ? <WhiteLabelDraftReview
            draft={draft}
            state={state}
            hasChanges={dirty}
            busy={busy}
            onSave={() => void save()}
            canSave={canSave}
            publicationControls={actorId ? <WhiteLabelPublicationControls
              actorId={actorId}
              draft={draft}
              hasChanges={dirty}
              draftValid={!draftProblem(state)}
              busy={busy}
              onReload={() => void load(tenantId)}
              onConfirmed={() => setStatus((current) => current.kind === "saved" ? { kind: "idle" } : current)}
            /> : undefined}
            onBack={() => {
              restoreReviewFocus.current = true;
              setReviewing(false);
            }}
          /> : undefined}
        />
      ) : !tenantId ? (
        listStatus === "ready" ? <WhiteLabelDraftList summaries={summaries} onContinue={chooseTenant} /> : <div className={styles.emptyState} role="status">
          <strong>{listStatus === "loading" ? "Loading Tenant drafts…" : listStatus === "denied" ? "Drafts unavailable" : "Drafts could not be loaded"}</strong>
          <p>{listStatus === "denied" ? "Your current session cannot manage these drafts." : listStatus === "failed" ? "No drafts have been changed. Try loading them again." : "Reading saved configurations from the server."}</p>
          {listStatus === "failed" ? <button type="button" className="button-secondary" onClick={() => void refreshList()}>Try again</button> : null}
        </div>
      ) : null}
    </div>
  );
}
