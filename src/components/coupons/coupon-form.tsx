"use client";

import { Check, LoaderCircle, Plus, RefreshCw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createCouponAction, updateCouponAction, type CouponActionState } from "../../app/actions/coupons";
import type { CouponDetail } from "../../repositories/coupon-repository";
import styles from "./coupon-admin.module.css";

export type CouponServiceOption = { id: string; name: string; folderName: string | null };

type EditorRule = {
  key: string;
  discountValue: string;
  appliesToAll: boolean;
  serviceIds: string[];
  search: string;
};

const CODE_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateCouponCode(length = 7) {
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => CODE_CHARACTERS[value % CODE_CHARACTERS.length]).join("");
}

function dateTimeLocalValue(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localValueToIso(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <button className="button-primary" disabled={pending} type="submit">
      {pending ? <LoaderCircle className="spinner" aria-hidden="true" /> : null}
      {mode === "create" ? "Create Coupon" : "Save Changes"}
    </button>
  );
}

export function CouponForm({
  mode,
  detail,
  services,
}: {
  mode: "create" | "edit";
  detail?: CouponDetail;
  services: CouponServiceOption[];
}) {
  const coupon = detail?.coupon;
  const [requestId] = useState(() => crypto.randomUUID());
  const [code, setCode] = useState(coupon?.code ?? "");
  const [discountType, setDiscountType] = useState<"fixed" | "percentage">(coupon?.discount_type ?? "percentage");
  const [expiryEnabled, setExpiryEnabled] = useState(Boolean(coupon?.expires_at));
  const [expiryLocal, setExpiryLocal] = useState(() => dateTimeLocalValue(coupon?.expires_at));
  const [minimumEnabled, setMinimumEnabled] = useState(coupon?.minimum_cart_amount != null);
  const [rules, setRules] = useState<EditorRule[]>(() => detail?.rules.map((rule) => ({
    key: rule.id,
    discountValue: String(rule.discount_value),
    appliesToAll: rule.applies_to_all,
    serviceIds: rule.serviceIds,
    search: "",
  })) ?? [{ key: "initial-rule", discountValue: "", appliesToAll: true, serviceIds: [], search: "" }]);

  const initialState: CouponActionState = { error: null, fieldErrors: {} };
  const updateAction = coupon ? updateCouponAction.bind(null, coupon.id) : null;
  const [state, action] = useActionState(mode === "edit" && updateAction ? updateAction : createCouponAction, initialState);

  const serializedRules = JSON.stringify(rules.map((rule) => ({
    discount_value: rule.discountValue === "" ? null : Number(rule.discountValue),
    applies_to_all: rule.appliesToAll,
    service_ids: rule.appliesToAll ? [] : rule.serviceIds,
  })));

  function updateRule(index: number, patch: Partial<EditorRule>) {
    setRules((current) => current.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule));
  }

  function toggleService(index: number, serviceId: string) {
    const rule = rules[index];
    if (!rule) return;
    const selected = rule.serviceIds.includes(serviceId);
    updateRule(index, {
      serviceIds: selected ? rule.serviceIds.filter((id) => id !== serviceId) : [...rule.serviceIds, serviceId],
    });
  }

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="rules" value={serializedRules} />
      <input type="hidden" name="expires_at" value={expiryEnabled ? localValueToIso(expiryLocal) : ""} />

      {state.error ? <div className="form-banner" role="alert">{state.error}</div> : null}

      <section className={styles.formSection} aria-labelledby="coupon-details-heading">
        <div className={styles.sectionHeading}><h2 id="coupon-details-heading">Coupon details</h2></div>
        <div className={styles.fields}>
          <div className={`${styles.field} ${styles.wide}`}>
            <label htmlFor="coupon-code">Coupon code</label>
            <div className={styles.codeInputRow}>
              <input id="coupon-code" name="code" value={code} maxLength={128} autoComplete="off" required onChange={(event) => setCode(event.currentTarget.value.toUpperCase())} aria-invalid={Boolean(state.fieldErrors.code)} />
              <button className="button-secondary" type="button" onClick={() => setCode(generateCouponCode())}><RefreshCw aria-hidden="true" />Generate</button>
            </div>
            <small>This is the code customers will enter at checkout.</small>
            {state.fieldErrors.code ? <em role="alert">{state.fieldErrors.code}</em> : null}
          </div>

          <label className={`${styles.field} ${styles.wide}`} htmlFor="coupon-description">
            <span>Description <small>optional</small></span>
            <textarea id="coupon-description" name="description" rows={3} defaultValue={coupon?.description ?? ""} />
            <small>Internal description. Customers will not see this.</small>
          </label>

          <fieldset className={`${styles.choiceGroup} ${styles.wide}`}>
            <legend>Discount type</legend>
            <div className={styles.radioCards}>
              <label><input name="discount_type" type="radio" value="fixed" checked={discountType === "fixed"} onChange={() => setDiscountType("fixed")} /><span><strong>Fixed amount</strong><small>A currency amount off each matched rule.</small></span></label>
              <label><input name="discount_type" type="radio" value="percentage" checked={discountType === "percentage"} onChange={() => setDiscountType("percentage")} /><span><strong>Percentage</strong><small>A percentage off the eligible subtotal.</small></span></label>
            </div>
          </fieldset>

          <fieldset className={`${styles.choiceGroup} ${styles.wide}`}>
            <legend>Recurring duration</legend>
            <div className={styles.radioCards}>
              <label><input name="recurring_duration" type="radio" value="forever" defaultChecked={(coupon?.recurring_duration ?? "forever") === "forever"} /><span><strong>Forever</strong><small>Apply to recurring renewals as well as the first payment.</small></span></label>
              <label><input name="recurring_duration" type="radio" value="first_payment" defaultChecked={coupon?.recurring_duration === "first_payment"} /><span><strong>First payment</strong><small>Apply only to the initial payment for recurring Services.</small></span></label>
            </div>
          </fieldset>
        </div>
      </section>

      <section className={styles.formSection} aria-labelledby="coupon-discounts-heading">
        <div className={styles.sectionHeading}><div><h2 id="coupon-discounts-heading">Discount rules</h2><p>Rules are checked in order. The first matching rule applies.</p></div></div>
        <div className={styles.ruleStack}>
          {rules.map((rule, index) => {
            const selectedOptions = rule.serviceIds.map((id) => services.find((service) => service.id === id)).filter((service): service is CouponServiceOption => Boolean(service));
            const needle = rule.search.trim().toLocaleLowerCase();
            const searchOptions = services.filter((service) => !rule.serviceIds.includes(service.id) && (!needle || `${service.name} ${service.folderName ?? ""}`.toLocaleLowerCase().includes(needle))).slice(0, 8);
            const discountError = state.fieldErrors[`rules.${index}.discount_value`];
            const serviceError = state.fieldErrors[`rules.${index}.service_ids`];

            return (
              <article className={styles.ruleCard} key={rule.key}>
                <header><h3>Rule {index + 1}</h3>{rules.length > 1 ? <button type="button" onClick={() => setRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index))}><Trash2 aria-hidden="true" />Remove</button> : null}</header>
                <div className={styles.ruleFields}>
                  <label className={styles.field}>
                    <span>Discount {discountType === "percentage" ? "(%)" : ""}</span>
                    <div className={styles.amountInput}>{discountType === "fixed" ? <span aria-hidden="true">$</span> : null}<input type="number" inputMode="decimal" min={discountType === "percentage" ? "0.01" : "0"} max={discountType === "percentage" ? "100" : "9999999999.99"} step="0.01" value={rule.discountValue} required aria-invalid={Boolean(discountError)} onChange={(event) => updateRule(index, { discountValue: event.currentTarget.value })} />{discountType === "percentage" ? <span aria-hidden="true">%</span> : null}</div>
                    {discountError ? <em role="alert">{discountError}</em> : null}
                  </label>

                  <fieldset className={styles.applicability}>
                    <legend>Applies to</legend>
                    <div>
                      <label><input type="radio" checked={rule.appliesToAll} onChange={() => updateRule(index, { appliesToAll: true, serviceIds: [], search: "" })} /><span>All Services</span></label>
                      <label><input type="radio" checked={!rule.appliesToAll} onChange={() => updateRule(index, { appliesToAll: false })} /><span>Specific Services</span></label>
                    </div>
                  </fieldset>

                  {!rule.appliesToAll ? (
                    <div className={`${styles.serviceSelector} ${styles.wide}`}>
                      <label htmlFor={`coupon-service-search-${index}`}>Specific Services</label>
                      {selectedOptions.length > 0 ? <div className={styles.selectedServices}>{selectedOptions.map((service) => <button key={service.id} type="button" onClick={() => toggleService(index, service.id)}>{service.name}<X aria-label={`Remove ${service.name}`} /></button>)}</div> : null}
                      <input id={`coupon-service-search-${index}`} type="search" value={rule.search} placeholder="Search services…" aria-invalid={Boolean(serviceError)} onChange={(event) => updateRule(index, { search: event.currentTarget.value })} />
                      <div className={styles.serviceResults} role="listbox" aria-label={`Services for rule ${index + 1}`}>
                        {searchOptions.map((service) => <button key={service.id} type="button" role="option" aria-selected="false" onClick={() => toggleService(index, service.id)}><span><strong>{service.name}</strong>{service.folderName ? <small>{service.folderName}</small> : null}</span><Plus aria-hidden="true" /></button>)}
                        {searchOptions.length === 0 ? <p>No matching active Services.</p> : null}
                      </div>
                      {serviceError ? <em role="alert">{serviceError}</em> : null}
                    </div>
                  ) : <p className={`${styles.allServicesNote} ${styles.wide}`}><Check aria-hidden="true" />This rule applies to every active Service.</p>}
                </div>
              </article>
            );
          })}
        </div>
        <button className={`${styles.addRule} button-secondary`} type="button" onClick={() => setRules((current) => [...current, { key: crypto.randomUUID(), discountValue: "", appliesToAll: true, serviceIds: [], search: "" }])}><Plus aria-hidden="true" />Add discount</button>
        {state.fieldErrors.rules ? <p className="field-error" role="alert">{state.fieldErrors.rules}</p> : null}
      </section>

      <section className={styles.formSection} aria-labelledby="coupon-limits-heading">
        <div className={styles.sectionHeading}><h2 id="coupon-limits-heading">Redemption limits</h2></div>
        <div className={styles.limitStack}>
          <label className={styles.toggle}><input name="single_use_per_customer" type="checkbox" defaultChecked={coupon?.single_use_per_customer ?? false} /><span><strong>Limit to one use per customer</strong><small>The redemption ledger remains the source of truth.</small></span></label>
          <label className={styles.toggle}><input name="new_customers_only" type="checkbox" defaultChecked={coupon?.new_customers_only ?? false} /><span><strong>New customers only</strong><small>Enforcement will become available with Store purchase history.</small></span></label>
          <div className={styles.conditionalLimit}>
            <label className={styles.toggle}><input name="set_expiry" type="checkbox" checked={expiryEnabled} onChange={(event) => setExpiryEnabled(event.currentTarget.checked)} /><span><strong>Set expiry date</strong><small>Saved as an exact timestamp.</small></span></label>
            {expiryEnabled ? <label className={styles.field} htmlFor="coupon-expiry"><span>Expiry date and time</span><input id="coupon-expiry" type="datetime-local" value={expiryLocal} required onChange={(event) => setExpiryLocal(event.currentTarget.value)} />{state.fieldErrors.expires_at ? <em role="alert">{state.fieldErrors.expires_at}</em> : null}</label> : null}
          </div>
          <div className={styles.conditionalLimit}>
            <label className={styles.toggle}><input name="set_minimum_cart" type="checkbox" checked={minimumEnabled} onChange={(event) => setMinimumEnabled(event.currentTarget.checked)} /><span><strong>Require a minimum cart amount</strong><small>Coupon can only be used when the pre-discount cart reaches this amount.</small></span></label>
            {minimumEnabled ? <label className={styles.field} htmlFor="coupon-minimum"><span>Minimum cart amount</span><div className={styles.amountInput}><span aria-hidden="true">$</span><input id="coupon-minimum" name="minimum_cart_amount" type="number" min="0" max="9999999999.99" step="0.01" defaultValue={coupon?.minimum_cart_amount ?? ""} required aria-invalid={Boolean(state.fieldErrors.minimum_cart_amount)} /></div>{state.fieldErrors.minimum_cart_amount ? <em role="alert">{state.fieldErrors.minimum_cart_amount}</em> : null}</label> : null}
          </div>
          <label className={styles.toggle}><input name="is_active" type="checkbox" defaultChecked={coupon?.is_active ?? true} /><span><strong>Coupon is active</strong><small>Inactive coupons remain editable but cannot be accepted.</small></span></label>
        </div>
      </section>

      <div className={styles.formActions}><Link className="button-secondary" href="/coupons">Cancel</Link><SubmitButton mode={mode} /></div>
    </form>
  );
}
