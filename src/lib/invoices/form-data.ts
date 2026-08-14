import { invoicePayloadSchema, issuedInvoiceUpdateSchema, type InvoicePayload } from "../../domain/invoices/schema";

export type InvoiceFormParseResult<T> =
  | { success: true; data: T }
  | { success: false; fieldErrors: Record<string, string> };

function issuePath(path: PropertyKey[]) {
  return path.map(String).join(".");
}

function fieldErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return Object.fromEntries(error.issues.map((issue) => [issuePath(issue.path), issue.message]));
}

export function parseMoneyToCents(value: string, allowZero = false): number | null {
  const normalized = value.trim();
  if (!/^\d{1,13}(?:\.\d{1,2})?$/u.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || (allowZero ? cents < 0 : cents <= 0)) return null;
  return cents;
}

export function centsToMoneyInput(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

function dueTimestamp(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T23:59:59+08:00` : null;
}

function billingReason(formData: FormData) {
  const value = String(formData.get("billing_reason") ?? "").trim();
  return value || null;
}

export function parseIssuedInvoiceFormData(formData: FormData): InvoiceFormParseResult<{
  billing_reason: InvoicePayload["billing_reason"];
  due_at: string | null;
}> {
  const result = issuedInvoiceUpdateSchema.safeParse({
    billing_reason: billingReason(formData),
    due_at: dueTimestamp(String(formData.get("due_date") ?? "")),
  });
  return result.success ? { success: true, data: result.data } : { success: false, fieldErrors: fieldErrors(result.error) };
}

export function parseInvoiceFormData(formData: FormData): InvoiceFormParseResult<InvoicePayload> {
  let items: unknown = null;
  try {
    items = JSON.parse(String(formData.get("items") ?? "null"));
  } catch {
    return { success: false, fieldErrors: { items: "Invoice items could not be read." } };
  }

  const taxTotal = parseMoneyToCents(String(formData.get("tax_total") ?? "0"), true);
  const result = invoicePayloadSchema.safeParse({
    company_id: String(formData.get("company_id") ?? ""),
    client_profile_id: null,
    currency: String(formData.get("currency") ?? "USD"),
    billing_reason: billingReason(formData),
    due_at: dueTimestamp(String(formData.get("due_date") ?? "")),
    tax_total_cents: taxTotal,
    items,
  });
  return result.success ? { success: true, data: result.data } : { success: false, fieldErrors: fieldErrors(result.error) };
}
