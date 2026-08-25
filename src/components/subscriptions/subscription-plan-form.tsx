"use client";

import { LoaderCircle, Lock } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createSubscriptionAction, updateSubscriptionTermsAction, type SubscriptionActionState } from "../../app/actions/subscriptions";
import { rankNameStrict } from "../../domain/invoices/rank-name";
import type { SubscriptionDetail } from "../../domain/subscriptions/schema";
import type { ServiceFolderRow, ServiceRow } from "../../lib/supabase/database-rows";
import { centsToMoneyInput } from "../../lib/invoices/form-data";
import { AnimatedSelect } from "../ui/animated-select";
import { DatePicker } from "../ui/date-picker";
import { SearchableSelect } from "../ui/searchable-select";
import { SubscriptionServicePicker } from "./subscription-service-picker";
import styles from "./subscriptions.module.css";

export type SubscriptionCompanyOption = {
  id: string;
  name: string;
  recordKind: "client" | "company";
};

export type SubscriptionServiceOption = Pick<
  ServiceRow,
  "id" | "name" | "price" | "currency" | "recurring" | "recurring_price" | "recurring_interval_length" | "recurring_interval_unit" | "recurring_action" | "folder_id" | "sort_order" | "is_active"
>;

function intervalUnit(value: ServiceRow["recurring_interval_unit"]): "day" | "week" | "month" | "year" {
  return value === "D" ? "day" : value === "W" ? "week" : value === "Y" ? "year" : "month";
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return <button className="button-primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}{mode === "create" ? "Create Subscription" : "Create New Plan Version"}</button>;
}

export function SubscriptionPlanForm({
  mode,
  companies,
  services,
  folders,
  today,
  requestId,
  subscriptionId,
  detail,
}: {
  mode: "create" | "edit";
  companies: SubscriptionCompanyOption[];
  services: SubscriptionServiceOption[];
  folders: ServiceFolderRow[];
  today: string;
  requestId: string;
  subscriptionId?: string;
  detail?: SubscriptionDetail;
}) {
  const currentItem = detail?.plan_items[0];
  const currentPlan = detail?.current_plan;
  const fixedServiceId = currentItem?.service_id ?? detail?.subscription.service_id;
  const initialService = services.find((service) => service.id === fixedServiceId);
  const [companyId, setCompanyId] = useState("");
  const [serviceId, setServiceId] = useState(initialService?.id ?? "");
  const [amount, setAmount] = useState(currentItem ? centsToMoneyInput(currentItem.unit_amount_cents) : String(initialService?.recurring_price ?? initialService?.price ?? 0));
  const [interval, setInterval] = useState(currentPlan?.interval_unit ?? intervalUnit(initialService?.recurring_interval_unit ?? null));
  const [intervalCount, setIntervalCount] = useState(String(currentPlan?.interval_count ?? initialService?.recurring_interval_length ?? 1));
  const [recurringAction, setRecurringAction] = useState(currentPlan?.recurring_action ?? initialService?.recurring_action ?? "none");
  const [endOfMonthPolicy, setEndOfMonthPolicy] = useState(currentPlan?.end_of_month_policy ?? "clamp");
  const [billingAnchor, setBillingAnchor] = useState(today);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const boundUpdate = subscriptionId ? updateSubscriptionTermsAction.bind(null, subscriptionId) : null;
  const initialState: SubscriptionActionState = { error: null, fieldErrors: {} };
  const [state, action] = useActionState(mode === "edit" && boundUpdate ? boundUpdate : createSubscriptionAction, initialState);

  function chooseService(nextId: string) {
    setServiceId(nextId);
    const service = services.find((candidate) => candidate.id === nextId);
    if (!service) return;
    setAmount(String(service.recurring_price ?? service.price));
    setInterval(intervalUnit(service.recurring_interval_unit));
    setIntervalCount(String(service.recurring_interval_length ?? 1));
    setRecurringAction(service.recurring_action ?? "none");
  }

  return (
    <form className={styles.planForm} action={action}>
      <input type="hidden" name="request_id" value={requestId} />
      {state.error ? <div className="form-banner" role="alert">{state.error}</div> : null}

      <section className={styles.formSection}>
        <header><h2>{mode === "create" ? "Subscription setup" : `Plan version ${(currentPlan?.version ?? 0) + 1}`}</h2><p>{mode === "create" ? "Service details are copied into an immutable initial plan." : "Changes create a new version. Existing invoices and prior terms are never rewritten."}</p></header>
        <div className={styles.formGrid}>
          {mode === "create" ? <label className={styles.wideField}><span>Client / company</span><SearchableSelect name="company_id" label="Client / company" options={companies.map((company) => ({ id: company.id, label: company.name, kind: company.recordKind }))} value={companyId} onChange={setCompanyId} placeholder="Search client or company..." menuLabel="Clients and companies" emptyMessage="No clients or companies found." menuRequiresQuery rank={rankNameStrict} required />{state.fieldErrors.company_id ? <em>{state.fieldErrors.company_id}</em> : null}</label> : null}
          <div className={`${styles.pickerField} ${styles.wideField}`}><span>Service</span><SubscriptionServicePicker folders={folders} services={services} value={serviceId} onChange={chooseService} disabled={mode === "edit"} error={state.fieldErrors.service_id} /><small>{mode === "edit" ? "The primary Service remains fixed for this Subscription; commercial terms below are versioned." : "Current Service values are used only as the initial snapshot."}</small></div>
          {mode === "create" ? <label><span>Billing anchor</span><DatePicker name="billing_anchor" label="Billing anchor" value={billingAnchor} onChange={setBillingAnchor} today={today} menuLabel="Billing anchor date" required /></label> : <label><span>Effective from <small>optional</small></span><DatePicker name="effective_from" label="Effective from" value={effectiveFrom} onChange={setEffectiveFrom} placeholder="Optional" today={today} menuLabel="Effective from date" /><small>Leave blank to apply after the current open cycle. No proration or retroactive Invoice change.</small></label>}
          <label><span>Currency</span><div className={styles.currencyFixed}><Lock size={13} aria-hidden="true" /><strong>USD</strong><input type="hidden" name="currency" value="USD" /></div></label>
        </div>
      </section>

      <section className={styles.formSection}>
        <header><h2>Billing terms</h2><p>The database remains authoritative for cycle dates and anchor behavior.</p></header>
        <div className={styles.formGrid}>
          <label><span>Interval</span><AnimatedSelect name="interval_unit" label="Interval" value={interval} onChange={(value) => setInterval(value as typeof interval)} menuLabel="Interval" required options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "year", label: "Year" }]} /></label>
          <label><span>Every</span><input name="interval_count" type="number" min="1" max="1000" required value={intervalCount} onChange={(event) => setIntervalCount(event.currentTarget.value)} /></label>
          <label><span>Month-end policy</span><AnimatedSelect name="end_of_month_policy" label="Month-end policy" value={endOfMonthPolicy} onChange={(value) => setEndOfMonthPolicy(value as "clamp" | "skip")} menuLabel="Month-end policy" options={[{ value: "clamp", label: "Use last valid day" }, { value: "skip", label: "Skip invalid month" }]} /></label>
          <label><span>Invoice lead days</span><input name="lead_days" type="number" min="0" max="90" required defaultValue={currentPlan?.lead_days ?? 5} /></label>
          <label><span>Past-due grace days</span><input name="grace_days" type="number" min="0" max="365" required defaultValue={currentPlan?.grace_days ?? 15} /></label>
          <label><span>Recurring fulfillment</span><AnimatedSelect name="recurring_action" label="Recurring fulfillment" value={recurringAction} onChange={(value) => setRecurringAction(value as typeof recurringAction)} menuLabel="Recurring fulfillment" options={[{ value: "none", label: "Do nothing" }, { value: "reopen_order", label: "Reopen existing Project" }, { value: "create_order", label: "Create new Project" }, { value: "client_request", label: "Client-requested work" }]} /></label>
          {recurringAction === "client_request" ? <><label><span>Total request limit</span><input name="request_limit_total" type="number" min="1" defaultValue={currentPlan?.request_limit_total ?? ""} /></label><label><span>Active request limit</span><input name="request_limit_active" type="number" min="1" defaultValue={currentPlan?.request_limit_active ?? ""} /></label></> : <><input type="hidden" name="request_limit_total" value="" /><input type="hidden" name="request_limit_active" value="" /></>}
        </div>
      </section>

      <section className={styles.formSection}>
        <header><h2>Recurring line item</h2><p>Money is validated and stored as integer cents. Coupon calculations are not performed here.</p></header>
        <div className={styles.formGrid}>
          <label><span>Quantity</span><input name="quantity" type="number" min="1" required defaultValue={currentItem?.quantity ?? 1} /></label>
          <label><span>Unit amount</span><input name="unit_amount" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.currentTarget.value)} />{state.fieldErrors.unit_amount ? <em>{state.fieldErrors.unit_amount}</em> : null}</label>
          <label><span>Unit discount</span><input name="unit_discount" inputMode="decimal" required defaultValue={currentItem ? centsToMoneyInput(currentItem.unit_discount_cents) : "0.00"} />{state.fieldErrors.unit_discount ? <em>{state.fieldErrors.unit_discount}</em> : null}</label>
          <label className={styles.checkboxField}><input name="is_taxable" type="checkbox" defaultChecked={currentItem?.is_taxable ?? true} /><span>Taxable line item</span></label>
        </div>
      </section>

      <footer className={styles.formFooter}><Link className="button-secondary" href={subscriptionId ? `/subscriptions/${subscriptionId}` : "/subscriptions"}>Cancel</Link><SubmitButton mode={mode} /></footer>
    </form>
  );
}
