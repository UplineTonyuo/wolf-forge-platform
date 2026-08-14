import { z } from "zod";
import { subscriptionEndOfMonthPolicies, subscriptionIntervalUnits, subscriptionRecurringActions } from "../../domain/subscriptions/schema";
import { parseMoneyToCents } from "../invoices/form-data";

const formSchema = z.object({
  request_id: z.uuid(),
  company_id: z.uuid().optional(),
  service_id: z.uuid(),
  billing_anchor: z.iso.date().optional(),
  effective_from: z.iso.date().optional(),
  interval_unit: z.enum(subscriptionIntervalUnits),
  interval_count: z.coerce.number().int().positive().max(1_000),
  end_of_month_policy: z.enum(subscriptionEndOfMonthPolicies),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/u),
  lead_days: z.coerce.number().int().min(0).max(90),
  grace_days: z.coerce.number().int().min(0).max(365),
  recurring_action: z.enum(subscriptionRecurringActions),
  request_limit_total: z.preprocess((value) => value === "" ? null : value, z.coerce.number().int().positive().nullable()),
  request_limit_active: z.preprocess((value) => value === "" ? null : value, z.coerce.number().int().positive().nullable()),
  quantity: z.coerce.number().int().positive().max(1_000_000),
  unit_amount: z.string().trim().min(1),
  unit_discount: z.string().trim().default("0"),
  is_taxable: z.boolean(),
}).superRefine((value, context) => {
  if (value.recurring_action !== "client_request" && (value.request_limit_total != null || value.request_limit_active != null)) {
    context.addIssue({ code: "custom", path: ["recurring_action"], message: "Request limits require client-request fulfillment." });
  }
  if (value.request_limit_total != null && value.request_limit_active != null && value.request_limit_active > value.request_limit_total) {
    context.addIssue({ code: "custom", path: ["request_limit_active"], message: "Active requests cannot exceed total requests." });
  }
});

export type ParsedSubscriptionForm = z.infer<typeof formSchema> & {
  unit_amount_cents: number;
  unit_discount_cents: number;
};

export type SubscriptionFormParseResult =
  | { success: true; data: ParsedSubscriptionForm }
  | { success: false; fieldErrors: Record<string, string> };

export function parseSubscriptionFormData(formData: FormData): SubscriptionFormParseResult {
  const raw = {
    request_id: String(formData.get("request_id") ?? ""),
    company_id: String(formData.get("company_id") ?? "") || undefined,
    service_id: String(formData.get("service_id") ?? ""),
    billing_anchor: String(formData.get("billing_anchor") ?? "") || undefined,
    effective_from: String(formData.get("effective_from") ?? "") || undefined,
    interval_unit: String(formData.get("interval_unit") ?? ""),
    interval_count: String(formData.get("interval_count") ?? ""),
    end_of_month_policy: String(formData.get("end_of_month_policy") ?? "clamp"),
    currency: String(formData.get("currency") ?? ""),
    lead_days: String(formData.get("lead_days") ?? "5"),
    grace_days: String(formData.get("grace_days") ?? "15"),
    recurring_action: String(formData.get("recurring_action") ?? "none"),
    request_limit_total: String(formData.get("request_limit_total") ?? ""),
    request_limit_active: String(formData.get("request_limit_active") ?? ""),
    quantity: String(formData.get("quantity") ?? "1"),
    unit_amount: String(formData.get("unit_amount") ?? ""),
    unit_discount: String(formData.get("unit_discount") ?? "0"),
    is_taxable: formData.get("is_taxable") === "on",
  };
  const parsed = formSchema.safeParse(raw);
  const amount = parseMoneyToCents(raw.unit_amount, true);
  const discount = parseMoneyToCents(raw.unit_discount || "0", true);
  const fieldErrors: Record<string, string> = {};

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
  }
  if (amount == null) fieldErrors.unit_amount = "Enter a valid amount with no more than two decimals.";
  if (discount == null) fieldErrors.unit_discount = "Enter a valid discount with no more than two decimals.";
  if (amount != null && discount != null && discount > amount) fieldErrors.unit_discount = "Discount cannot exceed the unit amount.";
  if (Object.keys(fieldErrors).length || !parsed.success || amount == null || discount == null) {
    return { success: false, fieldErrors };
  }
  return { success: true, data: { ...parsed.data, unit_amount_cents: amount, unit_discount_cents: discount } };
}
