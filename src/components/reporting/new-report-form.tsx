"use client";

import { useRouteTransitionPush } from "../shell/route-transition";

import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
  createServiceReportDraftAction,
  listReportServiceChoicesAction,
  type ReportServiceChoice,
} from "../../app/actions/reporting";
import {
  reportTitleSuggestion,
  reportingProfileForService,
  reportingProfileSummary,
} from "../../domain/reporting/service-profiles";
import { SearchableSelect } from "../ui/searchable-select";
import { reportCompletionMonthLabel, type ReportSetupScope } from "../../domain/reporting/order-completion";
import styles from "./reporting.module.css";

export type ReportClientOption = { id: string; name: string };

function choiceKey(choice: ReportServiceChoice): string {
  return `${choice.serviceId}:${choice.subscriptionId ?? "order"}`;
}

/** Client → actual subscribed Service → guided saved draft. */
export function NewReportForm({ clients, prefill, initialChoices = [] }: { clients: ReportClientOption[]; prefill?: ReportSetupScope; initialChoices?: ReportServiceChoice[] }) {
  const push = useRouteTransitionPush();
  const fieldId = useId();
  const [step, setStep] = useState<"client" | "service">(prefill ? "service" : "client");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const initialChoice = initialChoices.find((choice) => choice.serviceId === prefill?.serviceId);
  const initialProfile = prefill ? reportingProfileForService(prefill.serviceId) : null;
  const [companyId, setCompanyId] = useState(prefill?.companyId ?? "");
  const [choices, setChoices] = useState<ReportServiceChoice[]>(initialChoices);
  const [selectedChoiceKey, setSelectedChoiceKey] = useState(initialChoice ? choiceKey(initialChoice) : "");
  const [title, setTitle] = useState(initialProfile && prefill ? `${reportCompletionMonthLabel(prefill.reportingPeriodMonth)} ${initialProfile.packageLabel} Report` : "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientOptions = useMemo(
    () => clients.map((client) => ({ id: client.id, label: client.name })),
    [clients],
  );
  const selectedClient = clients.find((client) => client.id === companyId) ?? null;
  const selectedChoice = choices.find((choice) => choiceKey(choice) === selectedChoiceKey) ?? null;

  async function continueToService() {
    if (!companyId || loading) return;
    setLoading(true);
    setError(null);
    const result = await listReportServiceChoicesAction({ companyId });
    setLoading(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setChoices(result.choices);
    setSelectedChoiceKey("");
    setTitle("");
    setDirection("forward");
    setStep("service");
  }

  function chooseService(choice: ReportServiceChoice) {
    setSelectedChoiceKey(choiceKey(choice));
    const profile = reportingProfileForService(choice.serviceId);
    if (profile) setTitle(prefill ? `${reportCompletionMonthLabel(prefill.reportingPeriodMonth)} ${profile.packageLabel} Report` : reportTitleSuggestion(profile));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedChoice || !title.trim() || loading) return;
    setLoading(true);
    setError(null);

    const result = await createServiceReportDraftAction({
      requestId: crypto.randomUUID(),
      companyId,
      serviceId: selectedChoice.serviceId,
      subscriptionId: selectedChoice.subscriptionId,
      title: title.trim(),
      ...(prefill ? { reportingPeriodMonth: prefill.reportingPeriodMonth } : {}),
    });

    if (result.ok) {
      push(`/reporting/${result.reportId}`);
      return;
    }

    setLoading(false);
    setError(result.error);
  }

  return (
    <form className={styles.setupWizard} onSubmit={submit}>
      <div className={styles.setupProgress} aria-label="Report setup progress">
        <span>{step === "client" ? "Step 1 of 2" : "Step 2 of 2"}</span>
        <span className={styles.setupProgressTrack} aria-hidden="true">
          <span style={{ width: step === "client" ? "50%" : "100%" }} />
        </span>
      </div>

      <section
        key={step}
        className={styles.setupFocus}
        data-direction={direction}
        aria-labelledby={`${fieldId}-${step}-heading`}
      >
        {step === "client" ? (
          <>
            <header className={styles.setupFocusHead}>
              <h2 id={`${fieldId}-client-heading`}>Choose the client</h2>
              <p>Choose a Service this client purchased or currently receives.</p>
            </header>

            <label className={styles.field}>
              <span>Client company</span>
              <SearchableSelect
                label="Client"
                menuLabel="Clients and companies"
                options={clientOptions}
                value={companyId}
                onChange={setCompanyId}
                placeholder="Search client..."
                disabled={loading}
                required
              />
              {selectedClient ? (
                <em className={styles.fieldHint}>
                  Everyone with portal access at {selectedClient.name} can receive the sent report.
                </em>
              ) : null}
            </label>
          </>
        ) : (
          <>
            <header className={styles.setupFocusHead}>
              <h2 id={`${fieldId}-service-heading`}>Choose the Service</h2>
              {prefill ? <strong>{reportCompletionMonthLabel(prefill.reportingPeriodMonth)}</strong> : null}
              <p>
                {`Showing purchased and in-progress Reporting Services for ${selectedClient?.name ?? "this client"}.`}
              </p>
            </header>

            {choices.length === 0 ? (
              <div className={styles.setupEmpty}>
                <strong>No purchased or in-progress Reporting Services.</strong>
                <p>This client has no eligible subscription or order for a supported Reporting Service.</p>
              </div>
            ) : (
              <fieldset className={styles.serviceChoices} disabled={loading}>
                <legend className="sr-only">Service or subscription</legend>
                {choices.map((choice) => {
                  const profile = reportingProfileForService(choice.serviceId);
                  return (
                    <button
                      key={choiceKey(choice)}
                      type="button"
                      className={styles.serviceChoice}
                      aria-pressed={selectedChoiceKey === choiceKey(choice)}
                      onClick={() => chooseService(choice)}
                    >
                      <span>
                        <strong>{choice.serviceName}</strong>
                        <small>
                          {choice.subscriptionId
                            ? `${choice.subscriptionStatus ?? "active"} subscription`
                            : "Purchased or in-progress order"}
                        </small>
                      </span>
                      {profile ? (
                        <b>{reportingProfileSummary(profile)}</b>
                      ) : null}
                    </button>
                  );
                })}
              </fieldset>
            )}

            <label className={styles.field} htmlFor={`${fieldId}-title`}>
              <span>Report title</span>
              <input
                id={`${fieldId}-title`}
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                placeholder="August 2026 Platinum SEO Report"
                maxLength={200}
                disabled={loading || !selectedChoice}
                required
              />
              <em className={styles.fieldHint}>Suggested from this month and package; fully editable.</em>
            </label>

          </>
        )}
      </section>

      {error ? <p className={styles.problems} role="alert">{error}</p> : null}

      <div className={styles.setupActions}>
        {step === "service" ? (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              setDirection("back");
              setStep("client");
            }}
            disabled={loading}
          >
            <ArrowLeft aria-hidden="true" />
            Back
          </button>
        ) : <span />}

        {step === "client" ? (
          <button
            type="button"
            className={styles.primaryButton}
            aria-busy={loading || undefined}
            disabled={!companyId || loading}
            onClick={() => void continueToService()}
          >
            {loading ? <LoaderCircle className="spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
            {loading ? "Loading Services…" : "Continue"}
          </button>
        ) : (
          <button
            type="submit"
            className={styles.primaryButton}
            aria-busy={loading || undefined}
            disabled={!selectedChoice || !title.trim() || loading}
          >
            {loading ? <LoaderCircle className="spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
            {loading ? "Creating draft…" : "Start guided report"}
          </button>
        )}
      </div>
    </form>
  );
}
