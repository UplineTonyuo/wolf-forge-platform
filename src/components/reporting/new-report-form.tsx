"use client";

import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
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
import styles from "./reporting.module.css";

export type ReportClientOption = { id: string; name: string };

function choiceKey(choice: ReportServiceChoice): string {
  return `${choice.serviceId}:${choice.subscriptionId ?? "fallback"}`;
}

/** Client → actual subscribed Service → guided saved draft. */
export function NewReportForm({ clients }: { clients: ReportClientOption[] }) {
  const router = useRouter();
  const fieldId = useId();
  const [step, setStep] = useState<"client" | "service">("client");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [companyId, setCompanyId] = useState("");
  const [choices, setChoices] = useState<ReportServiceChoice[]>([]);
  const [fallback, setFallback] = useState(false);
  const [selectedChoiceKey, setSelectedChoiceKey] = useState("");
  const [title, setTitle] = useState("");
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
    setFallback(result.fallback);
    setSelectedChoiceKey("");
    setTitle("");
    setDirection("forward");
    setStep("service");
  }

  function chooseService(choice: ReportServiceChoice) {
    setSelectedChoiceKey(choiceKey(choice));
    const profile = reportingProfileForService(choice.serviceId);
    if (profile) setTitle(reportTitleSuggestion(profile));
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
    });

    if (result.ok) {
      router.push(`/reporting/${result.reportId}`);
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
              <p>The report and every subscription choice stay scoped to this company.</p>
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
              <p>
                {fallback
                  ? "No supported subscription is attached, so choose a Reporting profile from the active catalogue."
                  : `Showing supported subscriptions attached to ${selectedClient?.name ?? "this client"}.`}
              </p>
            </header>

            {choices.length === 0 ? (
              <div className={styles.setupEmpty}>
                <strong>No supported Reporting Services are available.</strong>
                <p>Check that the catalogue records are active, then try again.</p>
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
                            : "Catalogue profile fallback · no subscription attached"}
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

            {fallback ? (
              <p className={styles.fallbackNote}>
                This creates a report for the selected catalogue Service only. It does not create or imply a client subscription.
              </p>
            ) : null}
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
            disabled={!companyId || loading}
            onClick={() => void continueToService()}
          >
            {loading ? <LoaderCircle aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
            {loading ? "Loading Services…" : "Continue"}
          </button>
        ) : (
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={!selectedChoice || !title.trim() || loading}
          >
            {loading ? <LoaderCircle aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
            {loading ? "Creating draft…" : "Start guided report"}
          </button>
        )}
      </div>
    </form>
  );
}
