"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Link2,
  LoaderCircle,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { PortalDialog } from "../account/ui/portal-dialog";
import {
  saveReportDraftAction,
  sendReportDraftAction,
} from "../../app/actions/reporting";
import {
  addEntry,
  addSection,
  findDraftProblems,
  normalizeDraftSections,
  removeEntry,
  removeSection,
  renameSection,
  updateEntry,
} from "../../domain/reporting/builder";
import {
  applyQuickCompletedQuantity,
  blogPostsCompletedValue,
  clearOneTimeSetupEvidence,
  completedQuantityValue,
  dropUnreportedOneTimeSection,
  parseBlogCompletedCount,
  parseCompletedCount,
  quickCompletedQuantityOptions,
  reportWizardStepTitles,
  reportingProfileForService,
  recurringReportSectionOrder,
  standaloneGmbSectionOrder,
  withBlogDerivedYouTubeCount,
  wizardStepsForSections,
  youtubeStacksCompletedValue,
  type ReportWizardStepKey,
  type ServiceReportingProfile,
} from "../../domain/reporting/service-profiles";
import type {
  InternalReportDocument,
  ReportDraftEntryInput,
  ReportDraftSectionInput,
  ReportSendStatus,
} from "../../domain/reporting/schema";
import { formatBusinessDate } from "../../lib/dashboard/date-range";
import { ReportPreview } from "./report-preview";
import { ReportSaveNotice, ReportSendOutro } from "./report-flow-status";
import styles from "./reporting.module.css";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

type Direction = "forward" | "back";

/**
 * The current quick-select count for one step, held outside React state so
 * `persist` can see it without racing a state update.
 *
 * The wizard commits a quantity only when a step is saved or continued. On the
 * Blog and Podcast steps the visible default (the profile's expected amount)
 * lives here until Next / Save / Back turns it into a persisted entry value.
 */
type QuickCountSelection = { step: ReportWizardStepKey; count: number | null };

const profileSectionKeys = new Set<string>([
  ...recurringReportSectionOrder,
  ...standaloneGmbSectionOrder,
  "one_time_setup",
]);

function snapshot(
  title: string,
  step: ReportWizardStepKey,
  sections: readonly ReportDraftSectionInput[],
): string {
  return JSON.stringify({ title: title.trim(), step, sections: normalizeDraftSections(sections) });
}

function sectionIndex(
  sections: readonly ReportDraftSectionInput[],
  key: string,
): number {
  return sections.findIndex((section) => section.section_key === key);
}

function entryIndex(
  section: ReportDraftSectionInput | undefined,
  label: string,
): number {
  return section?.entries.findIndex((entry) => entry.label === label) ?? -1;
}

function findEntry(
  sections: readonly ReportDraftSectionInput[],
  sectionKey: string,
  label: string,
): ReportDraftEntryInput {
  const section = sections.find((candidate) => candidate.section_key === sectionKey);
  return section?.entries.find((entry) => entry.label === label)
    ?? { label, value: null, url: null };
}

function patchKnownEntry(
  sections: readonly ReportDraftSectionInput[],
  sectionKey: string,
  label: string,
  patch: Partial<ReportDraftEntryInput>,
): ReportDraftSectionInput[] {
  const targetSection = sectionIndex(sections, sectionKey);
  if (targetSection < 0) return [...sections];
  const targetEntry = entryIndex(sections[targetSection], label);
  if (targetEntry < 0) return [...sections];
  return updateEntry(sections, targetSection, targetEntry, patch);
}

function parsePerformanceScore(value: string | null | undefined): string {
  return value?.match(/^\s*(\d{1,3})%\s+Performance$/u)?.[1] ?? "";
}

function performanceValue(raw: string): string | null {
  if (raw === "") return null;
  return `${raw}% Performance`;
}

function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function requireReportingProfile(serviceId: string | null | undefined): ServiceReportingProfile {
  const profile = reportingProfileForService(serviceId);
  if (!profile) throw new Error("A guided report requires a supported Service profile.");
  return profile;
}

export function ReportWizard({
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
  const windowBlocked = sendStatus !== null && !sendStatus.can_send;
  const windowNote =
    sendStatus !== null && !sendStatus.send_anytime
      ? `Reporting window: ${formatBusinessDate(sendStatus.window_start)} – ${formatBusinessDate(sendStatus.window_end)}`
      : null;
  const profile = requireReportingProfile(initial.service_id);

  const initialSteps = wizardStepsForSections(initial.sections);
  const requestedInitialStep = initial.wizard_step_key as ReportWizardStepKey | undefined;
  const firstStep = requestedInitialStep && initialSteps.includes(requestedInitialStep)
    ? requestedInitialStep
    : initialSteps[0]!;

  const [title, setTitle] = useState(initial.title);
  const [sections, setSections] = useState<ReportDraftSectionInput[]>(initial.sections);
  const [step, setStep] = useState<ReportWizardStepKey>(firstStep);
  const [leaving, setLeaving] = useState<{ step: ReportWizardStepKey; direction: Direction } | null>(
    null,
  );
  const [direction, setDirection] = useState<Direction>("forward");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [sending, setSending] = useState(false);
  const [confirmingSend, setConfirmingSend] = useState(false);
  /* The completion faces: a confirmed save and a confirmed send both end
      back on the Reporting list after their short pause. */
  const [saveNotice, setSaveNotice] = useState(false);
  const [sent, setSent] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * Same-tick re-entry guard. Disabling the buttons stops a human double
   * click (React re-renders between clicks), but two clicks that land in the
   * same tick would both read `sending === false`. The ref closes that gap.
   */
  const busyRef = useRef(false);
  const [persisted, setPersisted] = useState(() =>
    snapshot(initial.title, firstStep, initial.sections),
  );
  const quickCountRef = useRef<QuickCountSelection | null>(null);

  const steps = wizardStepsForSections(sections);
  const stepPosition = Math.max(0, steps.indexOf(step));
  const dirty = snapshot(title, step, sections) !== persisted;
  const problems = findDraftProblems(sections);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(
    () => () => {
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
    },
    [],
  );

  /*
   * The completion faces play, then navigate back to the Reporting list
   * themselves (report-flow-status.tsx): each face owns its display duration
   * and clicks a hidden Link to /reporting. Save holds ~850ms, send ~1500ms —
   * deliberately not animations, just a pause with a finish.
   */

  async function persist(
    targetStep: ReportWizardStepKey = step,
    sectionsOverride?: ReportDraftSectionInput[],
  ): Promise<boolean> {
    setSave({ kind: "saving" });
    /*
     * A quick-select step commits its current selection only when the wizard
     * saves or continues. Rendering the step alone must never write a count;
     * the ref carries the visible selection (expected by default) and is
     * applied here, so Next / Save / Back confirms exactly what was on screen.
     * The override exists for one-shot documents — skip and send — that must
     * be saved before the wizard moves on; the live step's quick count never
     * applies to them.
     */
    const source = sectionsOverride ?? sections;
    const selection = quickCountRef.current;
    const committed = selection && selection.step === step
      ? applyQuickCompletedQuantity(source, selection.step, selection.count)
      : source;
    // The YouTube Stack count is derived from the blog count, never entered
    // again. Deriving here (in addition to the Blog step's live update) keeps a
    // saved draft consistent even when it predates this rule.
    const withDerived = withBlogDerivedYouTubeCount(committed);
    const normalized = normalizeDraftSections(withDerived);
    const result = await saveReportDraftAction({
      reportId: initial.report_id,
      reportLane: initial.report_lane,
      packageLabel: initial.package_label,
      title: title.trim(),
      wizardStepKey: targetStep,
      sections: normalized,
    });

    if (!result.ok) {
      setSave({ kind: "error", message: result.error });
      return false;
    }

    setSections(normalized);
    setPersisted(snapshot(title, targetStep, normalized));
    setSave({ kind: "saved" });
    return true;
  }

  function animateTo(targetStep: ReportWizardStepKey, nextDirection: Direction) {
    if (targetStep === step) return;
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    setLeaving({ step, direction: nextDirection });
    setDirection(nextDirection);
    setStep(targetStep);
    transitionTimer.current = setTimeout(() => setLeaving(null), 240);
  }

  async function goTo(targetStep: ReportWizardStepKey) {
    const targetIndex = steps.indexOf(targetStep);
    if (targetIndex < 0 || save.kind === "saving" || sending || saveNotice || sent) return;
    const nextDirection: Direction = targetIndex < stepPosition ? "back" : "forward";
    if (!(await persist(targetStep))) return;
    animateTo(targetStep, nextDirection);
  }

  /**
   * "Skip One-time Setup" — this report only.
   *
   * The section and its stable item keys stay in the document, so Back can
   * return and fill the step normally, and nothing durable is consumed: no
   * completion flag, no status, no URL, no deliverable record. Only the
   * draft-only evidence the operator may have typed this cycle is cleared, so
   * a skipped entry is never reported as completed or evidenced work. The
   * wizard then continues to the next applicable step, exactly like Next.
   */
  async function skipOneTimeSetup() {
    if (step !== "one_time_setup" || save.kind === "saving" || sending || saveNotice || sent) {
      return;
    }
    const nextStep = steps[stepPosition + 1];
    if (!nextStep) return;
    if (!(await persist(nextStep, clearOneTimeSetupEvidence(sections)))) return;
    animateTo(nextStep, "forward");
  }

  /**
   * "Save draft" — the durable, deliberate save. A failed save stays on the
   * page with the existing error; a successful one shows the "Draft saved"
   * face for a beat and returns to the Reporting list.
   */
  async function saveDraftAndLeave() {
    if (busyRef.current || save.kind === "saving" || sending || saveNotice || sent) return;
    busyRef.current = true;
    try {
      if (!(await persist(step))) return;
      setSaveNotice(true);
    } finally {
      busyRef.current = false;
    }
  }

  async function send() {
    if (busyRef.current || sending || saveNotice || sent || problems.length > 0 || !title.trim()) {
      return;
    }
    busyRef.current = true;
    try {
      setSending(true);
      /*
       * A skipped (or never filled) one-time step must not surface as an empty
       * section in the delivered report. The section is dropped from the saved
       * document only for this send; if the send fails, the original draft is
       * saved back unchanged, so a failed send alters nothing.
       */
      const originalSections = sections;
      const forSend = dropUnreportedOneTimeSection(sections);
      if (!(await persist("review", forSend))) {
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
        await persist("review", originalSections).catch(() => {});
        setSave({ kind: "error", message: result.error });
        return;
      }
      setSent(true);
    } finally {
      busyRef.current = false;
    }
  }

  const previous = steps[stepPosition - 1] ?? null;
  const next = steps[stepPosition + 1] ?? null;

  return (
    <div className={styles.wizard}>
      {/*
       * Two context zones, not one crowded row. Client and Service stack on
       * the left so a long package name wraps into its own space instead of
       * pushing the step title across the header; the step, its title and the
       * progress track stay together on the right.
       *
       * Whether the profile came from a subscription or from the catalogue is
       * an implementation detail of how the draft was built. It never changes
       * what William does on this screen, so only the affirmative case is
       * surfaced — the fallback resolution itself is untouched.
       */}
      <header className={styles.wizardHeader}>
        <div className={styles.wizardIdentity}>
          <div className={styles.wizardIdentityBlock} data-role="client">
            <span>Client</span>
            <strong>{initial.company_name}</strong>
          </div>
          <div className={styles.wizardIdentityBlock} data-role="service">
            <span>Service</span>
            <strong>{initial.service_name ?? profile.serviceName}</strong>
          </div>
          {initial.subscription_id ? <small>Attached subscription</small> : null}
        </div>

        <div className={styles.wizardProgress}>
          <div>
            <span>Step {stepPosition + 1} of {steps.length}</span>
            <strong>{reportWizardStepTitles[step]}</strong>
          </div>
          <span className={styles.wizardProgressTrack} aria-hidden="true">
            <span style={{ width: `${((stepPosition + 1) / steps.length) * 100}%` }} />
          </span>
        </div>
      </header>

      <div className={styles.wizardStage}>
        {leaving ? (
          <div
            className={styles.wizardStepLeaving}
            data-direction={leaving.direction}
            aria-hidden="true"
            inert
          >
            <WizardStep
              step={leaving.step}
              profile={profile}
              companyName={initial.company_name}
              title={title}
              sections={sections}
              commitRef={quickCountRef}
              onTitleChange={setTitle}
              onSectionsChange={setSections}
              onGoTo={(target) => void goTo(target)}
            />
          </div>
        ) : null}

        <div className={styles.wizardStepIncoming} data-direction={direction}>
          <WizardStep
            step={step}
            profile={profile}
            companyName={initial.company_name}
            title={title}
            sections={sections}
            commitRef={quickCountRef}
            onTitleChange={setTitle}
            onSectionsChange={setSections}
            onGoTo={(target) => void goTo(target)}
          />
        </div>
      </div>

      {problems.length > 0 ? (
        <div className={styles.wizardProblems} role="status">
          {problems.length} item{problems.length === 1 ? "" : "s"} still need attention before send.
        </div>
      ) : null}

      {!next && windowNote ? (
        <p className={styles.windowNote} role="status">
          {windowBlocked ? `Sending opens ${formatBusinessDate(sendStatus!.window_start)}. ` : null}
          {windowNote}
        </p>
      ) : null}

      <footer data-call-avoid className={styles.wizardActions}>
        <div>
          {previous ? (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void goTo(previous)}
              disabled={save.kind === "saving" || sending || saveNotice || sent}
            >
              <ArrowLeft aria-hidden="true" />
              Back
            </button>
          ) : <span />}
        </div>

        <span
          className={styles.actionsState}
          role="status"
          data-tone={save.kind === "error" ? "error" : save.kind === "saved" ? "saved" : undefined}
        >
          {save.kind === "saving"
            ? "Saving…"
            : save.kind === "error"
              ? save.message
              : dirty
                ? "Unsaved changes"
                : save.kind === "saved"
                  ? "Draft saved"
                  : "Progress saves as you continue"}
        </span>

        <div className={styles.wizardActionEnd}>
          <Link
            className={styles.advancedLink}
            href={`/reporting/${initial.report_id}?mode=advanced`}
          >
            Advanced edit
          </Link>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => void saveDraftAndLeave()}
            aria-busy={save.kind === "saving" || undefined}
            disabled={save.kind === "saving" || sending || saveNotice || sent}
          >
            {save.kind === "saving" ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}
            Save draft
          </button>
          {step === "one_time_setup" ? (
            <button
              type="button"
              className={styles.skipButton}
              onClick={() => void skipOneTimeSetup()}
              disabled={save.kind === "saving" || sending || saveNotice || sent}
            >
              Skip One-time Setup
            </button>
          ) : null}
          {next ? (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void goTo(next)}
              disabled={save.kind === "saving" || sending || saveNotice || sent}
            >
              Next
              <ArrowRight aria-hidden="true" />
            </button>
          ) : canSend ? (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setConfirmingSend(true)}
              disabled={
                save.kind === "saving" || sending || saveNotice || sent
                || problems.length > 0 || !title.trim() || windowBlocked
              }
              title={windowBlocked ? (windowNote ?? undefined) : undefined}
            >
              <Send aria-hidden="true" />
              Send to client
            </button>
          ) : null}
        </div>
      </footer>

      {/*
       * The one confirmation in the wizard, rendered through PortalDialog
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
        <p className={styles.confirmNote}>
          The report becomes read-only. Completed one-time items included here will not
          return by default in this client Service&apos;s next report.
        </p>
      </PortalDialog>

      <ReportSaveNotice open={saveNotice} />
      <ReportSendOutro open={sent} companyName={initial.company_name} />
    </div>
  );
}

function WizardStep({
  step,
  profile,
  companyName,
  title,
  sections,
  commitRef,
  onTitleChange,
  onSectionsChange,
  onGoTo,
}: {
  step: ReportWizardStepKey;
  profile: ServiceReportingProfile;
  companyName: string;
  title: string;
  sections: ReportDraftSectionInput[];
  commitRef: React.RefObject<QuickCountSelection | null>;
  onTitleChange: (title: string) => void;
  onSectionsChange: React.Dispatch<React.SetStateAction<ReportDraftSectionInput[]>>;
  onGoTo: (step: ReportWizardStepKey) => void;
}) {
  const patch = (
    sectionKey: string,
    label: string,
    entryPatch: Partial<ReportDraftEntryInput>,
  ) => onSectionsChange((current) => patchKnownEntry(current, sectionKey, label, entryPatch));

  if (step === "technical_seo") {
    return (
      <FocusedStep title="Technical SEO" description="Add the before-and-after site audit evidence.">
        <WizardUrlField
          label="Site Audit Before"
          value={findEntry(sections, step, "Site Audit Before").url}
          onChange={(url) => patch(step, "Site Audit Before", { url })}
        />
        <WizardUrlField
          label="Site Audit After"
          value={findEntry(sections, step, "Site Audit After").url}
          onChange={(url) => patch(step, "Site Audit After", { url })}
        />
      </FocusedStep>
    );
  }

  if (step === "performance") {
    return (
      <FocusedStep
        title="Performance"
        description="A score is optional. The supporting report link can stand on its own."
      >
        <div className={styles.performanceGrid}>
          {["Desktop Before", "Desktop After", "Mobile Before", "Mobile After"].map((label) => {
            const current = findEntry(sections, step, label);
            return (
              <div className={styles.performanceItem} key={label}>
                <h3>{label}</h3>
                <WizardUrlField
                  label={`${label} URL`}
                  value={current.url}
                  onChange={(url) => patch(step, label, { url })}
                />
                <label className={styles.field}>
                  <span>Performance score (optional)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={1}
                    value={parsePerformanceScore(current.value)}
                    onChange={(event) => {
                      const raw = event.currentTarget.value;
                      if (raw !== "" && !/^\d+$/u.test(raw)) return;
                      patch(step, label, { value: performanceValue(raw) });
                    }}
                    placeholder="25"
                  />
                  <em className={styles.fieldHint}>Rendered as “25% Performance”.</em>
                </label>
              </div>
            );
          })}
        </div>
      </FocusedStep>
    );
  }

  if (step === "blog_content") {
    const blogPosts = findEntry(sections, step, "Blog Posts");
    const expectedBlogs = profile.expected.blogs;
    return (
      <FocusedStep
        title="Blog Content / Blog Posts"
        description="Select how many blogs were actually completed. That same count is shared with Blog Posts and YouTube Stacks."
      >
        <WizardUrlField
          label="Blog Content asset URL"
          value={findEntry(sections, step, "Blog Content").url}
          onChange={(url) => patch(step, "Blog Content", { url })}
        />
        <QuickCountSelector
          question="How many blogs were completed?"
          expected={expectedBlogs}
          expectedCaption={`Expected this cycle: ${expectedBlogs} ${expectedBlogs === 1 ? "Blog" : "Blogs"}`}
          value={blogPosts.value}
          parse={parseCompletedCount}
          commitRef={commitRef}
          step={step}
          onCommit={(count) => {
            patch(step, "Blog Posts", { value: blogPostsCompletedValue(count) });
            patch("youtube_stack", "YouTube Stacks", {
              value: youtubeStacksCompletedValue(count),
            });
          }}
        />
        <WizardUrlField
          label="Blog Posts asset URL"
          value={blogPosts.url}
          onChange={(url) => patch(step, "Blog Posts", { url })}
        />
      </FocusedStep>
    );
  }

  if (step === "youtube_stack") {
    const current = findEntry(sections, step, "YouTube Stacks");
    const blogCount = parseBlogCompletedCount(
      findEntry(sections, "blog_content", "Blog Posts").value,
    );
    return (
      <FocusedStep
        title="YouTube Stack"
        description={`Expected this cycle: ${profile.expected.youtube_stacks}. The completed count follows the blogs you entered, shared with Blog Posts.`}
      >
        <div className={styles.derivedCount}>
          <span>YouTube Stacks completed</span>
          <strong>{blogCount === null ? "—" : blogCount}</strong>
          <em>
            {blogCount === null
              ? "Enter how many blogs were completed on the Blog step."
              : `Based on ${blogCount} completed ${blogCount === 1 ? "blog" : "blogs"} this cycle.`}
          </em>
        </div>
        <WizardUrlField
          label="YouTube Stack asset URL"
          value={current.url}
          onChange={(url) => patch(step, "YouTube Stacks", { url })}
        />
      </FocusedStep>
    );
  }

  if (step === "podcast_stack") {
    const label = "Podcast Stacks";
    const current = findEntry(sections, step, label);
    const expectedPodcasts = profile.expected.podcast_stacks;
    return (
      <FocusedStep
        title="Podcast Stack"
        description="Select how many Podcast Stacks were actually completed. This stays independent of the blog count."
      >
        <QuickCountSelector
          question={`How many ${label} were completed?`}
          expected={expectedPodcasts}
          expectedCaption={`Expected this cycle: ${expectedPodcasts} ${expectedPodcasts === 1 ? "Podcast Stack" : "Podcast Stacks"}`}
          value={current.value}
          parse={parseCompletedCount}
          commitRef={commitRef}
          step={step}
          onCommit={(quantity) =>
            patch(step, label, {
              value: completedQuantityValue(quantity, "Podcast Stack", label),
            })
          }
        />
        <WizardUrlField
          label="Supporting asset URL"
          value={current.url}
          onChange={(url) => patch(step, label, { url })}
        />
      </FocusedStep>
    );
  }

  if (step === "press_releases") {
    const target = sectionIndex(sections, step);
    const entries = target < 0 ? [] : sections[target]!.entries;
    return (
      <FocusedStep
        title="Press Releases"
        description={`Expected this cycle: ${profile.expected.press_releases}. Each delivered release keeps its own link.`}
      >
        <div className={styles.pressReleaseList}>
          {entries.map((release, index) => (
            <div className={styles.pressReleaseRow} key={index}>
              <WizardUrlField
                label={release.label}
                value={release.url}
                onChange={(url) =>
                  onSectionsChange((current) => updateEntry(current, target, index, { url }))
                }
              />
              <button
                type="button"
                className={styles.tool}
                aria-label={`Remove ${release.label}`}
                onClick={() =>
                  onSectionsChange((current) => removeEntry(current, target, index))
                }
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className={styles.addEntry}
          onClick={() =>
            onSectionsChange((current) => {
              const index = sectionIndex(current, step);
              if (index < 0) return current;
              const added = addEntry(current, index);
              return updateEntry(added, index, added[index]!.entries.length - 1, {
                label: `Press Release ${added[index]!.entries.length}`,
              });
            })
          }
        >
          <Plus aria-hidden="true" />
          Add another link
        </button>
      </FocusedStep>
    );
  }

  if (step === "gmb_management") {
    return (
      <FocusedStep
        title="GMB Management"
        description="Report the recurring content and posting evidence."
      >
        <WizardUrlField
          label="GMB Content"
          value={findEntry(sections, step, "GMB Content").url}
          onChange={(url) => patch(step, "GMB Content", { url })}
        />
        <WizardUrlField
          label="GMB Posting"
          value={findEntry(sections, step, "GMB Posting").url}
          onChange={(url) => patch(step, "GMB Posting", { url })}
        />
      </FocusedStep>
    );
  }

  if (step === "gmb_content" || step === "gmb_posting") {
    const label = step === "gmb_content" ? "GMB Content" : "GMB Posting";
    return (
      <FocusedStep
        title={label}
        description={`Add the supporting asset for this cycle's ${label.toLocaleLowerCase()}.`}
      >
        <WizardUrlField
          label={label}
          value={findEntry(sections, step, label).url}
          onChange={(url) => patch(step, label, { url })}
        />
      </FocusedStep>
    );
  }

  if (step === "one_time_setup") {
    const target = sectionIndex(sections, step);
    const entries = target < 0 ? [] : sections[target]!.entries;
    return (
      <FocusedStep
        title="One-time Setup"
        description="Only outstanding items appear. Mark complete only when this sent report records the finished deliverable."
      >
        <div className={styles.oneTimeList}>
          {entries.map((item, index) => {
            const hasEvidence = Boolean(item.value?.trim() || item.url?.trim());
            return (
              <section className={styles.oneTimeItem} key={item.one_time_item_key ?? index}>
                <h3>{item.label}</h3>
                <label className={styles.field}>
                  <span>Status or value</span>
                  <input
                    value={item.value ?? ""}
                    onChange={(event) => {
                      // Read the event value before the state updater runs:
                      // currentTarget is gone once the handler has returned.
                      const value = event.currentTarget.value;
                      onSectionsChange((current) =>
                        updateEntry(current, target, index, { value }),
                      );
                    }}
                    placeholder="Completed, delivered, or in progress"
                    maxLength={4000}
                  />
                </label>
                <WizardUrlField
                  label="Supporting URL (optional)"
                  value={item.url}
                  onChange={(url) =>
                    onSectionsChange((current) => updateEntry(current, target, index, { url }))
                  }
                />
                <label className={styles.completeCheck}>
                  <input
                    type="checkbox"
                    checked={item.one_time_completed ?? false}
                    disabled={!hasEvidence}
                    onChange={(event) => {
                      // Same rule as the status field: capture the flag while
                      // the event is live, never inside the state updater.
                      const checked = event.currentTarget.checked;
                      onSectionsChange((current) =>
                        updateEntry(current, target, index, {
                          one_time_completed: checked,
                        }),
                      );
                    }}
                  />
                  <span>
                    <Check aria-hidden="true" />
                    Completed and reported in this cycle
                  </span>
                </label>
              </section>
            );
          })}
        </div>
      </FocusedStep>
    );
  }

  if (step === "custom_additions") {
    const customSections = sections
      .map((section, index) => ({ section, index }))
      .filter(({ section }) => !profileSectionKeys.has(section.section_key));
    return (
      <FocusedStep
        title="Custom additions"
        description="Add unusual work without changing the Service profile."
      >
        {customSections.length === 0 ? (
          <p className={styles.customEmpty}>No custom report items yet.</p>
        ) : (
          <div className={styles.customSections}>
            {customSections.map(({ section, index: target }) => (
              <section className={styles.customSection} key={section.section_key}>
                <div className={styles.customSectionHead}>
                  <label className={styles.field}>
                    <span>Custom section</span>
                    <input
                      value={section.title}
                      onChange={(event) => {
                        const title = event.currentTarget.value;
                        onSectionsChange((current) =>
                          renameSection(current, target, title),
                        );
                      }}
                      maxLength={200}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.tool}
                    aria-label={`Remove ${section.title}`}
                    onClick={() =>
                      onSectionsChange((current) => removeSection(current, target))
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
                {section.entries.map((item, itemIndex) => (
                  <div className={styles.customEntry} key={itemIndex}>
                    <label className={styles.field}>
                      <span>Report item</span>
                      <input
                        value={item.label}
                        onChange={(event) => {
                          const label = event.currentTarget.value;
                          onSectionsChange((current) =>
                            updateEntry(current, target, itemIndex, { label }),
                          );
                        }}
                        placeholder="Custom deliverable"
                        maxLength={200}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Value or status</span>
                      <input
                        value={item.value ?? ""}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          onSectionsChange((current) =>
                            updateEntry(current, target, itemIndex, { value }),
                          );
                        }}
                        placeholder="Completed"
                        maxLength={4000}
                      />
                    </label>
                    <WizardUrlField
                      label="Supporting URL (optional)"
                      value={item.url}
                      onChange={(url) =>
                        onSectionsChange((current) =>
                          updateEntry(current, target, itemIndex, { url }),
                        )
                      }
                    />
                    <button
                      type="button"
                      className={styles.removeCustomEntry}
                      onClick={() =>
                        onSectionsChange((current) =>
                          removeEntry(current, target, itemIndex),
                        )
                      }
                    >
                      <Trash2 aria-hidden="true" />
                      Remove item
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={styles.addEntry}
                  onClick={() => onSectionsChange((current) => addEntry(current, target))}
                >
                  <Plus aria-hidden="true" />
                  Add item to this section
                </button>
              </section>
            ))}
          </div>
        )}
        <div className={styles.customButtons}>
          <button
            type="button"
            className={styles.addEntry}
            onClick={() =>
              onSectionsChange((current) => {
                const custom = current
                  .map((section, index) => ({ section, index }))
                  .filter(({ section }) => !profileSectionKeys.has(section.section_key))
                  .at(-1);
                if (custom) return addEntry(current, custom.index);
                const withSection = addSection(current, "Custom additions");
                return addEntry(withSection, withSection.length - 1);
              })
            }
          >
            <Plus aria-hidden="true" />
            Add report item
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() =>
              onSectionsChange((current) => addSection(current, "New custom section"))
            }
          >
            Add custom section
          </button>
        </div>
      </FocusedStep>
    );
  }

  return (
    <FocusedStep
      title="Review report"
      description="Review the native structured report, then return directly to any step that needs a correction."
    >
      <label className={styles.field}>
        <span>Report title and period</span>
        <input
          value={title}
          onChange={(event) => onTitleChange(event.currentTarget.value)}
          maxLength={200}
          required
        />
      </label>
      <nav className={styles.reviewNav} aria-label="Edit a report step">
        {wizardStepsForSections(sections)
          .filter((candidate) => candidate !== "review")
          .map((candidate) => (
            <button type="button" key={candidate} onClick={() => onGoTo(candidate)}>
              {reportWizardStepTitles[candidate]}
            </button>
          ))}
      </nav>
      <ReportPreview
        companyName={companyName}
        title={title}
        lane={profile.reportLane}
        packageLabel={profile.packageLabel}
        sections={normalizeDraftSections(sections)}
      />
    </FocusedStep>
  );
}

function FocusedStep({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.wizardStep}>
      <header className={styles.wizardStepHead}>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      <div className={styles.wizardFields}>{children}</div>
    </section>
  );
}

function WizardUrlField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
}) {
  const safe = isSafeHttpUrl(value);
  return (
    <label className={styles.field} data-invalid={!safe || undefined}>
      <span>{label}</span>
      <span className={styles.wizardUrlControl}>
        <Link2 aria-hidden="true" />
        <input
          type="url"
          inputMode="url"
          value={value ?? ""}
          onChange={(event) => onChange(event.currentTarget.value || null)}
          placeholder="https://..."
          maxLength={2000}
          aria-invalid={!safe}
        />
      </span>
      {!safe ? <em className={styles.fieldError}>Use an http:// or https:// link.</em> : null}
    </label>
  );
}

function QuickCountSelector({
  question,
  expected,
  expectedCaption,
  value,
  parse,
  commitRef,
  step,
  onCommit,
}: {
  question: string;
  expected: number;
  expectedCaption: string;
  value: string | null | undefined;
  parse: (value: string | null | undefined) => number | null;
  commitRef: React.RefObject<QuickCountSelection | null>;
  step: ReportWizardStepKey;
  onCommit: (count: number | null) => void;
}) {
  const groupName = useId();
  const options = quickCompletedQuantityOptions(expected);
  const [state, setState] = useState(() => {
    const saved = parse(value);
    const savedIsCustom = saved !== null && !options.includes(saved);
    return {
      count: saved ?? expected,
      custom: savedIsCustom,
      text: savedIsCustom ? String(saved) : "",
    };
  });

  /*
   * The count that would be persisted if the wizard saved right now. In quick
   * mode it is the selected chip; in custom mode it is whatever nonnegative
   * whole number the field holds, or null while the field is empty. It is
   * mirrored into commitRef so persist can turn the visible default into a
   * saved entry value without racing React state.
   */
  const committed = state.custom
    ? (state.text === "" ? null : Number.parseInt(state.text, 10))
    : state.count;

  useEffect(() => {
    commitRef.current = { step, count: committed };
    return () => {
      if (commitRef.current?.step === step) commitRef.current = null;
    };
  }, [committed, step, commitRef]);

  function pick(count: number) {
    setState({ count, custom: false, text: "" });
    onCommit(count);
  }

  function pickCustom() {
    const previous = state.custom
      ? (state.text === "" ? null : Number.parseInt(state.text, 10))
      : state.count;
    setState({
      count: previous ?? expected,
      custom: true,
      text: previous === null ? "" : String(previous),
    });
    onCommit(previous);
  }

  function typeCustom(raw: string) {
    if (raw !== "" && !/^\d+$/u.test(raw)) return;
    setState((current) => ({ ...current, text: raw }));
    onCommit(raw === "" ? null : Number.parseInt(raw, 10));
  }

  return (
    <fieldset className={styles.quickCountGroup}>
      <legend className={styles.quickCountLegend}>{question}</legend>
      <div className={styles.quickCountOptions}>
        {options.map((count) => (
          <label
            key={count}
            className={styles.quickCountOption}
            data-checked={!state.custom && state.count === count}
          >
            <input
              type="radio"
              name={groupName}
              value={String(count)}
              checked={!state.custom && state.count === count}
              onChange={() => pick(count)}
            />
            <span>{count}</span>
          </label>
        ))}
        <label className={styles.quickCountOption} data-checked={state.custom}>
          <input
            type="radio"
            name={groupName}
            value="custom"
            checked={state.custom}
            onChange={pickCustom}
          />
          <span>Custom</span>
        </label>
      </div>
      {state.custom ? (
        <div className={styles.quickCountCustom}>
          <label className={styles.field}>
            <span>Custom completed count</span>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={state.text}
              onChange={(event) => typeCustom(event.currentTarget.value)}
              placeholder="0"
              maxLength={6}
            />
          </label>
          <em className={styles.fieldHint}>Whole numbers only.</em>
        </div>
      ) : null}
      <em className={styles.quickCountExpected}>{expectedCaption}</em>
    </fieldset>
  );
}
