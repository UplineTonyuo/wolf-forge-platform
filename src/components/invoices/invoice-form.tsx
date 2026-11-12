"use client";

import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { createInvoiceAction, updateInvoiceAction, type InvoiceActionState } from "../../app/actions/invoices";
import { centsToMoneyInput, parseMoneyToCents } from "../../lib/invoices/form-data";
import styles from "./invoice-admin.module.css";
import { AnimatedSelect } from "../ui/animated-select";
import { SearchableSelect } from "../ui/searchable-select";
import { DatePicker } from "../ui/date-picker";
import { ServicePicker, type PickerFolder } from "../services/service-picker";

export type InvoiceCompanyOption = { id: string; name: string };
export type InvoiceServiceOption = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  folderName: string | null;
  folderId: string | null;
};

export type InvoiceFormInitial = {
  id: string;
  status: "draft" | "unpaid" | "payment_pending";
  companyId: string;
  currency: string;
  billingReason: string | null;
  dueDate: string;
  taxTotalCents: number;
  items: Array<{
    id: string;
    serviceId: string | null;
    name: string;
    description: string;
    quantity: number;
    unitPriceCents: number;
    unitDiscountCents: number;
    taxable: boolean;
  }>;
};

type EditorItem = {
  key: string;
  kind: "service" | "custom";
  serviceId: string | null;
  name: string;
  description: string;
  quantity: string;
  unitPrice: string;
  unitDiscount: string;
  taxable: boolean;
};

const initialActionState: InvoiceActionState = { error: null, fieldErrors: {} };

function emptyItem(): EditorItem {
  return {
    key: crypto.randomUUID(),
    kind: "custom",
    serviceId: null,
    name: "",
    description: "",
    quantity: "1",
    unitPrice: "0.00",
    unitDiscount: "0.00",
    taxable: false,
  };
}

function initialItems(initial?: InvoiceFormInitial): EditorItem[] {
  if (!initial) return [emptyItem()];
  return initial.items.map((item) => ({
    key: item.id,
    kind: item.serviceId ? "service" : "custom",
    serviceId: item.serviceId,
    name: item.name,
    description: item.description,
    quantity: String(item.quantity),
    unitPrice: centsToMoneyInput(item.unitPriceCents),
    unitDiscount: centsToMoneyInput(item.unitDiscountCents),
    taxable: item.taxable,
  }));
}

function labelForBillingReason(value: string | null) {
  if (value === "subscription_create") return "New subscription";
  if (value === "subscription_cycle") return "Recurring payment";
  if (value === "subscription_update") return "Proration";
  if (value === "subscription_threshold") return "Usage threshold";
  return "Manual invoice";
}

export function InvoiceForm({
  mode,
  requestId,
  companies,
  services,
  folders,
  initial,
  defaultDueDate = "",
  defaultCompanyId,
}: {
  mode: "create" | "edit";
  requestId: string;
  companies: InvoiceCompanyOption[];
  services: InvoiceServiceOption[];
  folders: PickerFolder[];
  initial?: InvoiceFormInitial;
  defaultDueDate?: string;
  defaultCompanyId?: string;
}) {
  const issued = Boolean(initial && initial.status !== "draft");
  const action = mode === "create" ? createInvoiceAction : updateInvoiceAction.bind(null, initial?.id ?? "");
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const [items, setItems] = useState<EditorItem[]>(() => initialItems(initial));
  const [taxTotal, setTaxTotal] = useState(() => centsToMoneyInput(initial?.taxTotalCents ?? 0));
  const [companyId, setCompanyId] = useState(initial?.companyId ?? defaultCompanyId ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? "USD");
  const [billingReason, setBillingReason] = useState(initial?.billingReason ?? "manual");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? defaultDueDate);
  const pickerServices = useMemo(() => services.map((service) => ({ id: service.id, name: service.name, folder_id: service.folderId, price: service.priceCents / 100, currency: service.currency, is_active: true })), [services]);

  const serializedItems = useMemo(() => JSON.stringify(items.map((item) => ({
    service_id: item.kind === "service" ? item.serviceId : null,
    name: item.name.trim(),
    description: item.description.trim() || null,
    quantity: /^\d+$/u.test(item.quantity) ? Number(item.quantity) : 0,
    unit_price_cents: parseMoneyToCents(item.unitPrice, true) ?? -1,
    unit_discount_cents: parseMoneyToCents(item.unitDiscount, true) ?? -1,
    is_taxable: mode === "create" ? false : item.taxable,
  }))), [items, mode]);

  const preview = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    for (const item of items) {
      const quantity = /^\d+$/u.test(item.quantity) ? Number(item.quantity) : 0;
      const unitPrice = parseMoneyToCents(item.unitPrice, true) ?? 0;
      const unitDiscount = parseMoneyToCents(item.unitDiscount, true) ?? 0;
      if (!Number.isSafeInteger(quantity) || quantity < 0) continue;
      subtotal += unitPrice * quantity;
      discount += unitDiscount * quantity;
    }
    const tax = parseMoneyToCents(taxTotal, true) ?? 0;
    return { subtotal, discount, tax, total: subtotal - discount + tax };
  }, [items, taxTotal]);

  function updateItem(key: string, patch: Partial<EditorItem>) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  function chooseService(key: string, service: InvoiceServiceOption) {
    updateItem(key, {
      kind: "service",
      serviceId: service.id,
      name: service.name,
      description: service.description,
      unitPrice: centsToMoneyInput(service.priceCents),
    });
  }

  return (
    <form className={styles.form} action={formAction}>
      {mode === "create" ? <input type="hidden" name="request_id" value={requestId} /> : null}
      {!issued ? <input type="hidden" name="items" value={serializedItems} /> : null}
      {mode === "create" ? <input type="hidden" name="tax_total" value="0.00" /> : null}
      <section className={styles.formSection}>
        <div className={styles.sectionHeading}><h2>Basic</h2><p>Set the client and invoice terms.</p></div>
        <div className={styles.basicFields}>
          {!issued ? (
            <>
              <div className={styles.field}><span>Client / Company</span><SearchableSelect name="company_id" label="Client / Company" required menuRequiresQuery options={companies.map((company) => ({ id: company.id, label: company.name }))} value={companyId} onChange={setCompanyId} placeholder="Search clients" menuLabel="Clients and companies" />{state.fieldErrors.company_id ? <em>{state.fieldErrors.company_id}</em> : null}</div>
              <div className={styles.field}><span>Currency</span><AnimatedSelect name="currency" label="Currency" menuLabel="Currencies" value={currency} onChange={setCurrency} options={["USD", "GBP", "EUR", "PHP"].map((value) => ({ value, label: value }))} /></div>
            </>
          ) : null}
          <div className={styles.field}><span>Billing reason</span><AnimatedSelect name="billing_reason" label="Billing reason" menuLabel="Billing reasons" value={billingReason} onChange={setBillingReason} options={["manual", "subscription_create", "subscription_cycle", "subscription_update", "subscription_threshold"].map((value) => ({ value, label: labelForBillingReason(value) }))} /></div>
          <div className={styles.field}><span>Due date</span><DatePicker name="due_date" label="Due date" menuLabel="Invoice due date" value={dueDate} onChange={setDueDate} required />{state.fieldErrors.due_at ? <em>{state.fieldErrors.due_at}</em> : null}</div>
          {!issued && mode === "edit" ? <label className={styles.field}><span>Tax total</span><div className={styles.moneyInput}><span aria-hidden="true">$</span><input name="tax_total" inputMode="decimal" value={taxTotal} onChange={(event) => setTaxTotal(event.target.value)} /></div></label> : null}
        </div>
      </section>

      {!issued ? (
        <section className={styles.formSection}>
          <div className={styles.sectionHeading}><h2>Items</h2><p>Snapshot Services or add custom work.</p></div>
          <div className={styles.itemEditor}>
            {items.map((item, index) => {
              return (
                <article className={styles.itemRow} key={item.key}>
                  <header><strong>Item {index + 1}</strong><div><AnimatedSelect name={`item-kind-${index}`} label={`Item ${index + 1} type`} menuLabel={`Item ${index + 1} type`} value={item.kind} onChange={(kind) => updateItem(item.key, { kind: kind as EditorItem["kind"], serviceId: null })} options={[{ value: "service", label: "Service" }, { value: "custom", label: "Custom Item" }]} />{items.length > 1 ? <button className={styles.removeItem} type="button" aria-label={`Remove item ${index + 1}`} onClick={() => setItems((current) => current.filter((candidate) => candidate.key !== item.key))}><Trash2 aria-hidden="true" />Remove</button> : null}</div></header>
                  <div className={styles.itemFields}>
                    {item.kind === "service" ? (
                      <div className={styles.serviceField}><ServicePicker name="" label={`Item ${index + 1} service`} folders={folders} services={pickerServices} value={item.serviceId ?? ""} onChange={(id) => { const service = services.find((candidate) => candidate.id === id); if (service) chooseService(item.key, service); }} /></div>
                    ) : <label className={styles.field}><span>Custom item</span><input value={item.name} onChange={(event) => updateItem(item.key, { name: event.target.value })} placeholder="Item name" /></label>}
                    <label className={`${styles.field} ${styles.descriptionField}`}><span>Description</span><textarea rows={3} value={item.description} onChange={(event) => updateItem(item.key, { description: event.target.value })} /></label>
                    <label className={styles.field}><span>Quantity</span><input inputMode="numeric" value={item.quantity} onChange={(event) => updateItem(item.key, { quantity: event.target.value })} /></label>
                    <label className={styles.field}><span>Unit price</span><input inputMode="decimal" value={item.unitPrice} onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })} /></label>
                    <label className={styles.field}><span>Unit discount</span><input inputMode="decimal" value={item.unitDiscount} onChange={(event) => updateItem(item.key, { unitDiscount: event.target.value })} /></label>
                    {mode === "edit" ? <label className={styles.taxable}><input type="checkbox" checked={item.taxable} onChange={(event) => updateItem(item.key, { taxable: event.target.checked })} /><span>Taxable</span></label> : null}
                  </div>
                </article>
              );
            })}
            {state.fieldErrors.items ? <p className={styles.formError}>{state.fieldErrors.items}</p> : null}
            <button className="button-secondary" type="button" onClick={() => setItems((current) => [...current, emptyItem()])}><Plus aria-hidden="true" />Add Item</button>
            <div className={styles.preview} aria-label="Invoice totals preview"><div><span>Subtotal</span><strong>{centsToMoneyInput(preview.subtotal)}</strong></div><div><span>Discount</span><strong>−{centsToMoneyInput(preview.discount)}</strong></div>{mode === "edit" ? <div><span>Tax</span><strong>{centsToMoneyInput(preview.tax)}</strong></div> : null}<div className={styles.previewTotal}><span>Total</span><strong>{centsToMoneyInput(preview.total)}</strong></div></div>
          </div>
        </section>
      ) : null}

      {state.error ? <p className={styles.formError} role="alert">{state.error}</p> : null}
      <footer data-call-avoid className={styles.formActions}><Link className="button-secondary" href={initial ? `/invoices/${initial.id}` : "/invoices"}>Cancel</Link><button className="button-primary" type="submit" aria-busy={pending || undefined} disabled={pending}>{pending ? <><LoaderCircle className="spinner" aria-hidden="true" />Saving…</> : mode === "create" ? "Create Draft" : "Save Changes"}</button></footer>
    </form>
  );
}
