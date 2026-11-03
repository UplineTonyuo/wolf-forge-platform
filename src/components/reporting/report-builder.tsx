"use client";

import { useRouteTransitionPush } from "../shell/route-transition";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Eye,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { PortalDialog } from "../account/ui/portal-dialog";
import {
  discardReportDraftAction,
  saveReportDraftAction,
  sendReportDraftAction,
} from "../../app/actions/reporting";
import {
  addEntry,
  addSection,
  countEntries,
  findDraftProblems,
  moveEntry,
  moveSection,
  normalizeDraftSections,
  removeEntry,
  removeSection,
  renameSection,
  updateEntry,
} from "../../domain/reporting/builder";
import {
  maxReportSections,
  reportLaneLabels,
  reportLanes,
  type InternalReportDocument,
  type ReportDraftSectionInput,
  type ReportLane,
  type ReportSendStatus,
} from "../../domain/reporting/schema";
import {
  calendarDateToMonthInputValue,
  monthInputValueToPeriodDate,
  parseCalendarDate,
} from "../../domain/reporting/send-window";
import { formatBusinessDate } from "../../lib/dashboard/date-range";
import { formatDate } from "../../lib/format";
import { ReportPreview } from "./report-preview";
import { ReportSaveNotice, ReportSendOutro } from "./report-flow-status";
import styles from "./reporting.module.css";

/**
 * The report builder.
 *
 * One piece of state — the section array — edited through the pure operations
 * in domain/reporting/builder. Array position is the order all the way down to
 * the database, so reordering is a swap and nothing has to be renumbered.
 *
 * The document this receives came from the database, which means a refresh or a
 * return visit resumes exactly what was saved. Nothing here pretends local
 * state is a draft: the save button is the only thing that makes a change
 * durable, and the bar says so.
 *
 * Reordering is up/down buttons rather than drag and drop. Drag is nicer to
 * demonstrate and worse to use — it needs a pointer, it is hard to make
 * accessible, and William reorders a section perhaps twice a month. Two buttons
 * work with a keyboard, a screen reader and a trackpad without any of that.
 */

/** One comparable string for "is this the same report that was saved". */
function snapshot(
  title: string,
  packageLabel: string,
  lane: ReportLane,
  periodMonth: string,
  sections: readonly ReportDraftSectionInput[],
): string {
  return JSON.stringify({
    title: title.trim(),
    packageLabel: packageLabel.trim(),
    lane,
    periodMonth,
    sections: normalizeDraftSections(sections),
  });
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export function ReportBuilder({
  document: initial,
  canSend,
  sendStatus = null,
}: {
  document: InternalReportDocument;
  /** Presentation only — every RPC re-checks reports.send for itself. */
  canSend: boolean;
  /** Presentation only — every send RPC re-derives and re-enforces this independently. */
  sendStatus?: ReportSendStatus | null;
}) {
  const push = useRouteTransitionPush();
  const fieldId = useId();

  const readOnly = initial.status === "sent";

  const [title, setTitle] = useState(initial.title);
  const [packageLabel, setPackageLabel] = useState(initial.package_label);
  const [lane, setLane] = useState<ReportLane>(initial.report_lane);
  const [periodMonth, setPeriodMonth] = useState(
    calendarDateToMonthInputValue(parseCalendarDate(initial.reporting_period_month)),
  );
  const [sections, setSections] = useState<ReportDraftSectionInput[]>(initial.sections);

  const [showPreview, setShowPreview] = useState(false);
  const [confirmingSend, setConfirmingSend] = useState(false);
  /* Two-step rather than a second dialog: one modal in this screen is enough. */
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [sending, setSending] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  /* The completion faces: a confirmed save and a confirmed send both end
      back on the Reporting list after their short pause. */
  const [saveNotice, setSaveNotice] = useState(false);
  const [sent, setSent] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  /*
   * Same-tick re-entry guard. Disabling the buttons stops a human double
   * click (React re-renders between clicks), but two clicks that land in the
   * same tick would both read `sending === false`. The ref closes that gap.
   */
  const busyRef = useRef(false);

  /*
   * What is actually stored, as a comparable snapshot. State rather than a ref
   * because it is read while rendering — the action bar and the unload warning
   * both depend on it — and a ref read during render is not a dependency React
   * will re-render for.
   */
  const [persisted, setPersisted] = useState(() =>
    snapshot(
      initial.title,
      initial.package_label,
      initial.report_lane,
      periodMonth,
      initial.sections,
    ),
  );

  const current = snapshot(title, packageLabel, lane, periodMonth, sections);
  const dirty = current !== persisted;
  const problems = findDraftProblems(sections);
  const headerIncomplete = title.trim() === "" || packageLabel.trim() === "";

  /*
   * Leaving with unsaved work is a real loss — a full month of entries — so the
   * browser's own confirmation is used rather than a bespoke interception that
   * cannot cover a closed tab.
   */
  useEffect(() => {
    if (!dirty || readOnly) return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, readOnly]);

  /*
   * The completion faces play, then navigate back to the Reporting list
   * themselves (report-flow-status.tsx): each face owns its display duration
   * and clicks a hidden Link to /reporting. Save holds ~850ms, send ~1500ms —
   * deliberately not animations, just a pause with a finish.
   */

  async function saveDraft(): Promise<boolean> {
    if (readOnly) return false;

    setSave({ kind: "saving" });

    const normalized = normalizeDraftSections(sections);

    const result = await saveReportDraftAction({
      reportId: initial.report_id,
      reportLane: lane,
      packageLabel: packageLabel.trim(),
      title: title.trim(),
      reportingPeriodMonth: monthInputValueToPeriodDate(periodMonth),
      sections: normalized,
    });

    if (!result.ok) {
      setSave({ kind: "error", message: result.error });
      return false;
    }

    setPersisted(snapshot(title, packageLabel, lane, periodMonth, normalized));

    // Abandoned rows are dropped on save, so the editor shows what was stored.
    setSections(normalized);
    setSave({ kind: "saved" });
    return true;
  }

  /**
   * "Save draft" — the durable, deliberate save. A failed save stays on the
   * page with the existing error; a successful one shows the "Draft saved"
   * face for a beat and returns to the Reporting list.
   */
  async function saveDraftAndLeave() {
    if (busyRef.current || readOnly || save.kind === "saving" || sending || saveNotice || sent) {
      return;
    }
    busyRef.current = true;
    try {
      if (!(await saveDraft())) return;
      setSaveNotice(true);
    } finally {
      busyRef.current = false;
    }
  }

  async function send() {
    if (busyRef.current || sending || saveNotice || sent) return;
    busyRef.current = true;
    try {
      setSending(true);

      /*
       * Save first, always. Sending what is on screen rather than what was last
       * saved is the only behaviour that cannot surprise the operator, and the
       * send RPC reads the stored report.
       */
      const saved = await saveDraft();
      if (!saved) {
        setSending(false);
        setConfirmingSend(false);
        return;
      }

      const result = await sendReportDraftAction({
        requestId: crypto.randomUUID(),
        reportId: initial.report_id,
      });

      setSending(false);
      setConfirmingSend(false);

      if (!result.ok) {
        setSave({ kind: "error", message: result.error });
        return;
      }
      setSent(true);
    } finally {
      busyRef.current = false;
    }
  }

  async function discard() {
    const result = await discardReportDraftAction({ reportId: initial.report_id });
    if (result.ok) push("/reporting");
    else setSave({ kind: "error", message: result.error });
  }

  const sendBlocked = problems.length > 0 || headerIncomplete || sections.length === 0;
  /*
   * Presentation only: the send RPC re-derives and re-enforces this
   * independently. sendStatus reflects the period as of page load — saving a
   * changed period updates the stored value immediately, but this note (and
   * the button it disables) catches up on the next load rather than live,
   * matching how every other field here already treats "saved" vs "on screen".
   */
  const windowBlocked = sendStatus !== null && !sendStatus.can_send;
  const windowNote =
    sendStatus !== null && !sendStatus.send_anytime
      ? `Reporting window: ${formatBusinessDate(sendStatus.window_start)} – ${formatBusinessDate(sendStatus.window_end)}`
      : null;

  return (
    <div className={styles.builder}>
      {/*
       * A sent report is read-only, so it has no editor footer and no other way
       * out of the detail. It sits above the identity card rather than inside
       * it, because it navigates away from the report rather than describing
       * it. The destination is /reporting rather than browser history: the
       * Reporting list is the parent workspace for a report however the
       * operator arrived here.
       */}
      {readOnly ? (
        <Link className={styles.backLink} href="/reporting">
          <ArrowLeft aria-hidden="true" />
          Back
        </Link>
      ) : null}

      <div className={styles.identity}>
        <span className={styles.identityName}>{initial.company_name}</span>
        <span className={styles.identityMeta}>
          <strong>{reportLaneLabels[lane]}</strong> · {packageLabel || "No package label"}
        </span>
        <span className={styles.status} data-status={initial.status}>
          {initial.status === "sent"
            ? `Sent ${initial.sent_at ? formatDate(initial.sent_at) : ""}`.trim()
            : "Draft"}
        </span>
        {!readOnly && initial.service_id ? (
          <Link className={styles.advancedLink} href={`/reporting/${initial.report_id}`}>
            Guided edit
          </Link>
        ) : null}
      </div>

      {readOnly ? (
        <ReportPreview
          companyName={initial.company_name}
          title={title}
          lane={lane}
          packageLabel={packageLabel}
          sections={sections}
          sentLabel={initial.sent_at ? `Sent ${formatDate(initial.sent_at)}` : null}
        />
      ) : (
        <>
          <section className={styles.step}>
            <div className={styles.stepHead}>
              <span className={styles.stepNumber}>
                <Pencil aria-hidden="true" />
              </span>
              <div>
                <h2>Report information</h2>
                <p>What the client sees at the top of the report.</p>
              </div>
            </div>

            <label className={styles.field} htmlFor={`${fieldId}-title`}>
              <span>Report title and period</span>
              <input
                id={`${fieldId}-title`}
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                placeholder="August 2026 SEO Report"
                maxLength={200}
                required
              />
            </label>

            <label className={styles.field} htmlFor={`${fieldId}-period`}>
              <span>Reporting period</span>
              <input
                id={`${fieldId}-period`}
                type="month"
                value={periodMonth}
                onChange={(event) => setPeriodMonth(event.currentTarget.value)}
                required
              />
              <em className={styles.fieldHint}>
                Which month this report covers. Defaults to the current month; correct it for a
                report written for an earlier or later period.
              </em>
            </label>

            <label className={styles.field} htmlFor={`${fieldId}-package`}>
              <span>Package label</span>
              <input
                id={`${fieldId}-package`}
                value={packageLabel}
                onChange={(event) => setPackageLabel(event.currentTarget.value)}
                placeholder="Platinum SEO"
                maxLength={200}
                required
              />
            </label>

            <fieldset className={styles.choiceRow}>
              <legend className="sr-only">Reporting lane</legend>
              {reportLanes.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={styles.choice}
                  aria-pressed={lane === option}
                  onClick={() => setLane(option)}
                >
                  <strong>{reportLaneLabels[option]}</strong>
                </button>
              ))}
            </fieldset>
          </section>

          <ol className={styles.sections}>
            {sections.map((section, sectionIndex) => (
              <li className={styles.section} key={`${section.section_key}-${sectionIndex}`}>
                <div className={styles.sectionHead}>
                  <label>
                    <span className="sr-only">Section {sectionIndex + 1} title</span>
                    <input
                      className={styles.sectionTitleInput}
                      value={section.title}
                      onChange={(event) =>
                        setSections((current) =>
                          renameSection(current, sectionIndex, event.target.value),
                        )
                      }
                      placeholder="Section title"
                      maxLength={200}
                    />
                  </label>

                  <div className={styles.rowTools}>
                    <button
                      type="button"
                      className={styles.tool}
                      aria-label={`Move ${section.title || "section"} up`}
                      disabled={sectionIndex === 0}
                      onClick={() =>
                        setSections((current) => moveSection(current, sectionIndex, -1))
                      }
                    >
                      <ArrowUp aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={styles.tool}
                      aria-label={`Move ${section.title || "section"} down`}
                      disabled={sectionIndex === sections.length - 1}
                      onClick={() =>
                        setSections((current) => moveSection(current, sectionIndex, 1))
                      }
                    >
                      <ArrowDown aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={`${styles.tool} ${styles.toolDanger}`}
                      aria-label={`Remove ${section.title || "section"}`}
                      onClick={() => setSections((current) => removeSection(current, sectionIndex))}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {section.entries.length === 0 ? (
                  <p className={styles.entryEmpty}>
                    Nothing reported here yet. Add an entry for what happened this period.
                  </p>
                ) : (
                  <ul className={styles.entries}>
                    {section.entries.map((entry, entryIndex) => (
                      <EntryRow
                        key={entryIndex}
                        entry={entry}
                        entryIndex={entryIndex}
                        entryCount={section.entries.length}
                        sectionTitle={section.title}
                        onChange={(patch) =>
                          setSections((current) =>
                            updateEntry(current, sectionIndex, entryIndex, patch),
                          )
                        }
                        onMove={(direction) =>
                          setSections((current) =>
                            moveEntry(current, sectionIndex, entryIndex, direction),
                          )
                        }
                        onRemove={() =>
                          setSections((current) =>
                            removeEntry(current, sectionIndex, entryIndex),
                          )
                        }
                      />
                    ))}
                  </ul>
                )}

                <div className={styles.sectionFoot}>
                  <button
                    type="button"
                    className={styles.addEntry}
                    onClick={() => setSections((current) => addEntry(current, sectionIndex))}
                  >
                    <Plus aria-hidden="true" />
                    Add entry
                  </button>
                </div>
              </li>
            ))}
          </ol>

          <button
            type="button"
            className={styles.addSection}
            disabled={sections.length >= maxReportSections}
            onClick={() => setSections((current) => addSection(current))}
          >
            + Add section
          </button>

          {problems.length > 0 ? (
            <div className={styles.problems} role="status">
              <strong>
                {problems.length} thing{problems.length === 1 ? "" : "s"} to fix before sending
              </strong>
              <ul>
                {problems.slice(0, 6).map((problem, index) => (
                  <li key={index}>
                    {sections[problem.sectionIndex]?.title || `Section ${problem.sectionIndex + 1}`}
                    {problem.entryIndex === null ? "" : ` · entry ${problem.entryIndex + 1}`} —{" "}
                    {problem.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {showPreview ? (
            <ReportPreview
              companyName={initial.company_name}
              title={title}
              lane={lane}
              packageLabel={packageLabel}
              sections={normalizeDraftSections(sections)}
            />
          ) : null}
        </>
      )}

      {!readOnly && windowNote ? (
        <p className={styles.windowNote} role="status">
          {windowBlocked ? `Sending opens ${formatBusinessDate(sendStatus!.window_start)}. ` : null}
          {windowNote}
        </p>
      ) : null}

      <div className={styles.actions}>
        <span
          className={styles.actionsState}
          role="status"
          data-tone={
            save.kind === "error" ? "error" : save.kind === "saved" && !dirty ? "saved" : undefined
          }
        >
          {readOnly
            ? "This report has been sent and can no longer be edited."
            : save.kind === "error"
              ? save.message
              : save.kind === "saving"
                ? "Saving…"
                : dirty
                  ? "Unsaved changes"
                  : save.kind === "saved"
                    ? "Draft saved"
                    : `${sections.length} sections · ${countEntries(sections)} entries`}
        </span>

        {readOnly ? null : (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => setShowPreview((open) => !open)}
            aria-expanded={showPreview}
          >
            <Eye aria-hidden="true" />
            {showPreview ? "Hide preview" : "Preview"}
          </button>
        )}

        {readOnly ? null : (
          <>
            <button
              type="button"
              className={styles.dangerButton}
              data-armed={confirmingDiscard ? "true" : undefined}
              onClick={() =>
                confirmingDiscard ? void discard() : setConfirmingDiscard(true)
              }
              onBlur={() => setConfirmingDiscard(false)}
              disabled={sending || saveNotice || sent || save.kind === "saving"}
            >
              {confirmingDiscard ? "Discard for good?" : "Discard draft"}
            </button>

            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void saveDraftAndLeave()}
              aria-busy={save.kind === "saving" || undefined}
              disabled={saveNotice || sent || save.kind === "saving" || sending}
            >
              {save.kind === "saving" ? (
                <LoaderCircle className="spinner" aria-hidden="true" />
              ) : save.kind === "saved" && !dirty ? (
                <Check aria-hidden="true" />
              ) : (
                <Save aria-hidden="true" />
              )}
              Save draft
            </button>

            {canSend ? (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => setConfirmingSend(true)}
                disabled={
                  saveNotice || sent || sendBlocked || windowBlocked || sending
                  || save.kind === "saving"
                }
                title={
                  sendBlocked
                    ? "Fix the outstanding items first."
                    : windowBlocked
                      ? windowNote ?? undefined
                      : undefined
                }
              >
                <Send aria-hidden="true" />
                Send to client
              </button>
            ) : null}
          </>
        )}
      </div>

      {/*
       * The one confirmation in the builder, rendered through PortalDialog
       * (portaled to document.body, D-055): fixed to the viewport, centered
       * no matter where in the report the operator scrolled, with the shared
       * focus trap, focus return, Escape, backdrop close and scroll lock.
       * Cancel takes the focus so one Enter cannot send by accident.
       */}
      <PortalDialog
        open={confirmingSend}
        onClose={() => setConfirmingSend(false)}
        title={`Send this report to ${initial.company_name}?`}
        description="The client will receive this report in their portal."
        initialFocusRef={cancelRef}
        footer={
          <div className={styles.confirmActions}>
            <button
              ref={cancelRef}
              type="button"
              className={styles.secondaryButton}
              onClick={() => setConfirmingSend(false)}
              disabled={sending}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void send()}
              aria-busy={sending || undefined}
              disabled={sending}
            >
              {sending ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Send aria-hidden="true" />}
              {sending ? "Sending…" : "Send report"}
            </button>
          </div>
        }
      >
        <dl className={styles.confirmFacts}>
          <div>
            <dt>Client</dt>
            <dd>{initial.company_name}</dd>
          </div>
          <div>
            <dt>Report</dt>
            <dd>{title.trim() || "Untitled report"}</dd>
          </div>
          <div>
            <dt>Package</dt>
            <dd>
              {packageLabel} · {reportLaneLabels[lane]}
            </dd>
          </div>
        </dl>
      </PortalDialog>

      <ReportSaveNotice open={saveNotice} />
      <ReportSendOutro open={sent} companyName={initial.company_name} />
    </div>
  );
}

/**
 * One entry.
 *
 * The label is always present. The link field only appears once there is a link
 * or the operator asks for one, because most entries are text — "Technical SEO
 * updated", "In progress", "Improved from 12 to 4" — and a URL box on every row
 * would suggest the opposite.
 */
function EntryRow({
  entry,
  entryIndex,
  entryCount,
  sectionTitle,
  onChange,
  onMove,
  onRemove,
}: {
  entry: ReportDraftSectionInput["entries"][number];
  entryIndex: number;
  entryCount: number;
  sectionTitle: string;
  onChange: (patch: Partial<ReportDraftSectionInput["entries"][number]>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  /*
   * Derived, not remembered. Rows are keyed by position, so a reorder hands
   * this component a different entry; state alone would leave a real URL hidden
   * behind a row that no longer owns it. The toggle only ever adds a field the
   * data does not already require.
   */
  const [requested, setRequested] = useState(false);
  const showUrl = requested || (entry.url !== null && entry.url !== "");
  const urlInvalid =
    entry.url !== null && entry.url.trim() !== "" && !/^https?:\/\/\S+$/iu.test(entry.url.trim());

  const where = `entry ${entryIndex + 1} in ${sectionTitle || "this section"}`;

  return (
    <li className={styles.entry}>
      <div className={styles.entryFields}>
        <label className={styles.entryLabelField}>
          <span className="sr-only">Label for {where}</span>
          <input
            value={entry.label}
            onChange={(event) => onChange({ label: event.target.value })}
            placeholder="Label, e.g. Technical SEO"
            maxLength={200}
          />
        </label>

        <label>
          <span className="sr-only">Value or status for {where}</span>
          <input
            value={entry.value ?? ""}
            onChange={(event) => onChange({ value: event.target.value })}
            placeholder="Value or status, e.g. 4 posts completed"
            maxLength={4000}
          />
        </label>

        {showUrl ? (
          <div className={styles.entryUrlField} data-invalid={urlInvalid ? "true" : undefined}>
            <label className={styles.entryUrlInput}>
              <span className="sr-only">Link for {where}</span>
              <input
                type="url"
                inputMode="url"
                value={entry.url ?? ""}
                onChange={(event) => onChange({ url: event.target.value })}
                placeholder="https://..."
                maxLength={2000}
              />
            </label>
            <button
              type="button"
              className={styles.tool}
              aria-label={`Remove the link on ${where}`}
              onClick={() => {
                onChange({ url: null });
                setRequested(false);
              }}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.linkToggle}
            onClick={() => setRequested(true)}
          >
            <Link2 aria-hidden="true" />
            Add link
          </button>
        )}
      </div>

      <div className={styles.rowTools}>
        <button
          type="button"
          className={styles.tool}
          aria-label={`Move ${where} up`}
          disabled={entryIndex === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.tool}
          aria-label={`Move ${where} down`}
          disabled={entryIndex === entryCount - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${styles.tool} ${styles.toolDanger}`}
          aria-label={`Remove ${where}`}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

/**
 * The one confirmation in the builder now lives in PortalDialog above.
 *
 * Editing has no confirmations at all — undoing an edit is free. Sending is the
 * only irreversible act, so it is the only one that stops and restates who is
 * about to receive what. The dialog itself (focus trap, focus return, Escape,
 * backdrop close, scroll lock, exit animation) is the shared PortalDialog —
 * D-010 and D-055.
 */
