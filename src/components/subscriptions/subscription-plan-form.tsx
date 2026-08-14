"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createSubscriptionAction, updateSubscriptionTermsAction, type SubscriptionActionState } from "../../app/actions/subscriptions";
import type { SubscriptionDetail } from "../../domain/subscriptions/schema";
import type { CompanyRow, ServiceRow } from "../../lib/supabase/database-rows";
import { centsToMoneyInput } from "../../lib/invoices/form-data";
import styles from "./subscriptions.module.css";

export type SubscriptionServiceOption = Pick<
  ServiceRow,
  "id" | "name" | "price" | "currency" | "recurring" | "recurring_price" | "recurring_interval_length" | "recurring_interval_unit" | "recurring_action"
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
  today,
  requestId,
  subscriptionId,
  detail,
}: {
  mode: "create" | "edit";
  companies: CompanyRow[];
  services: SubscriptionServiceOption[];
  today: string;
  requestId: string;
  subscriptionId?: string;
  detail?: SubscriptionDetail;
}) {
  const currentItem = detail?.plan_items[0];
  const currentPlan = detail?.current_plan;
  const fixedServiceId = currentItem?.service_id ?? detail?.subscription.service_id;
  const initialService = services.find((service) => service.id === fixedServiceId) ?? services[0];
  const [serviceId, setServiceId] = useState(initialService?.id ?? "");
  const [amount, setAmount] = useState(currentItem ? centsToMoneyInput(currentItem.unit_amount_cents) : String(initialService?.recurring_price ?? initialService?.price ?? 0));
  const [currency, setCurrency] = useState(currentPlan?.currency ?? initialService?.currency ?? "USD");
  const [interval, setInterval] = useState(currentPlan?.interval_unit ?? intervalUnit(initialService?.recurring_interval_unit ?? null));
  const [intervalCount, setIntervalCount] = useState(String(currentPlan?.interval_count ?? initialService?.recurring_interval_length ?? 1));
  const [recurringAction, setRecurringAction] = useState(currentPlan?.recurring_action ?? initialService?.recurring_action ?? "none");
  const boundUpdate = subscriptionId ? updateSubscriptionTermsAction.bind(null, subscriptionId) : null;
  const initialState: SubscriptionActionState = { error: null, fieldErrors: {} };
  const [state, action] = useActionState(mode === "edit" && boundUpdate ? boundUpdate : createSubscriptionAction, initialState);

  function chooseService(nextId: string) {
    setServiceId(nextId);
    const service = services.find((candidate) => candidate.id === nextId);
    if (!service) return;
    setAmount(String(service.recurring_price ?? service.price));
    setCurrency(service.currency);
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
          {mode === "create" ? <label className={styles.wideField}><span>Client / company</span><select name="company_id" required defaultValue=""><option value="" disabled>Choose a client</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select>{state.fieldErrors.company_id ? <em>{state.fieldErrors.company_id}</em> : null}</label> : null}
          <label className={styles.wideField}><span>Service</span><select name="service_id" required value={serviceId} disabled={mode === "edit"} onChange={(event) => chooseService(event.currentTarget.value)}>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select>{mode === "edit" ? <input type="hidden" name="service_id" value={serviceId} /> : null}<small>{mode === "edit" ? "The primary Service remains fixed for this Subscription; commercial terms below are versioned." : "Current Service values are used only as the initial snapshot."}</small></label>
          {mode === "create" ? <label><span>Billing anchor</span><input name="billing_anchor" type="date" required defaultValue={today} /></label> : <label><span>Effective from <small>optional</small></span><input name="effective_from" type="date" /><small>Leave blank to apply after the current open cycle. No proration or retroactive Invoice change.</small></label>}
          <label><span>Currency</span><input name="currency" value={currency} maxLength={3} required onChange={(event) => setCurrency(event.currentTarget.value.toUpperCase())} /></label>
        </div>
      </section>

      <section className={styles.formSection}>
        <header><h2>Billing terms</h2><p>The database remains authoritative for cycle dates and anchor behavior.</p></header>
        <div className={styles.formGrid}>
          <label><span>Interval</span><select name="interval_unit" value={interval} onChange={(event) => setInterval(event.currentTarget.value as typeof interval)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option></select></label>
          <label><span>Every</span><input name="interval_count" type="number" min="1" max="1000" required value={intervalCount} onChange={(event) => setIntervalCount(event.currentTarget.value)} /></label>
          <label><span>Month-end policy</span><select name="end_of_month_policy" defaultValue={currentPlan?.end_of_month_policy ?? "clamp"}><option value="clamp">Use last valid day</option><option value="skip">Skip invalid month</option></select></label>
          <label><span>Invoice lead days</span><input name="lead_days" type="number" min="0" max="90" required defaultValue={currentPlan?.lead_days ?? 5} /></label>
          <label><span>Past-due grace days</span><input name="grace_days" type="number" min="0" max="365" required defaultValue={currentPlan?.grace_days ?? 15} /></label>
          <label><span>Recurring fulfillment</span><select name="recurring_action" value={recurringAction} onChange={(event) => setRecurringAction(event.currentTarget.value as typeof recurringAction)}><option value="none">Do nothing</option><option value="reopen_order">Reopen existing Project</option><option value="create_order">Create new Project / task</option><option value="client_request">Client-requested work</option></select></label>
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
