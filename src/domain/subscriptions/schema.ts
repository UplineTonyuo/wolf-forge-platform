import { z } from "zod";
import type {
  SubscriptionCycleRow,
  SubscriptionDunningAttemptRow,
  SubscriptionEventRow,
  SubscriptionPaymentMethodRow,
  SubscriptionPlanItemRow,
  SubscriptionPlanVersionRow,
  SubscriptionRow,
} from "../../lib/supabase/database-rows";
import { uuidSchema } from "../shared";

export const subscriptionStatuses = [
  "active", "past_due", "paused", "pending_cancellation", "canceled",
] as const;
export const subscriptionPlanSources = [
  "admin_invoice", "checkout", "payment_link", "service_purchase",
] as const;
export const subscriptionIntervalUnits = ["day", "week", "month", "year"] as const;
export const subscriptionEndOfMonthPolicies = ["clamp", "skip"] as const;
export const subscriptionRecurringActions = [
  "none", "reopen_order", "create_order", "client_request",
] as const;
export const subscriptionCycleStatuses = [
  "scheduled", "invoiced", "paid", "past_due", "voided", "skipped",
] as const;
export const subscriptionHealthStates = [
  ...subscriptionStatuses, "stalled", "requires_attention",
] as const;

const centsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/u);

export const subscriptionPlanItemInputSchema = z.object({
  service_id: uuidSchema.nullable(),
  name: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).max(2_000).nullable().optional(),
  quantity: z.number().int().positive().max(1_000_000),
  unit_amount_cents: centsSchema,
  unit_discount_cents: centsSchema.default(0),
  coupon_id: uuidSchema.nullable().optional(),
  is_taxable: z.boolean().default(true),
}).refine(
  (item) => item.unit_discount_cents <= item.unit_amount_cents,
  { path: ["unit_discount_cents"], message: "Discount cannot exceed unit amount." },
);

const termsSchema = z.object({
  interval_unit: z.enum(subscriptionIntervalUnits),
  interval_count: z.number().int().positive().max(1_000),
  end_of_month_policy: z.enum(subscriptionEndOfMonthPolicies).default("clamp"),
  currency: currencySchema,
  lead_days: z.number().int().min(0).max(90).default(5),
  grace_days: z.number().int().min(0).max(365).default(15),
  recurring_action: z.enum(subscriptionRecurringActions),
  request_limit_total: z.number().int().positive().nullable().optional(),
  request_limit_active: z.number().int().positive().nullable().optional(),
  items: z.array(subscriptionPlanItemInputSchema).min(1).max(100),
}).superRefine((terms, context) => {
  if (terms.recurring_action !== "client_request"
    && (terms.request_limit_total != null || terms.request_limit_active != null)) {
    context.addIssue({
      code: "custom",
      path: ["recurring_action"],
      message: "Request limits are only valid for client-request fulfillment.",
    });
  }
  if (terms.request_limit_total != null && terms.request_limit_active != null
    && terms.request_limit_active > terms.request_limit_total) {
    context.addIssue({
      code: "custom",
      path: ["request_limit_active"],
      message: "Active request limit cannot exceed the total request limit.",
    });
  }
});

export const createSubscriptionSchema = z.object({
  request_id: uuidSchema,
  company_id: uuidSchema,
  client_profile_id: uuidSchema.nullable(),
  service_id: uuidSchema,
  plan_source: z.enum(subscriptionPlanSources),
  billing_anchor: z.iso.date(),
  external_processor: z.string().trim().min(1).max(100).nullable().optional(),
  external_processor_reference: z.string().trim().min(1).max(500).nullable().optional(),
}).and(termsSchema);

export const updateSubscriptionTermsSchema = z.object({
  request_id: uuidSchema,
  effective_from: z.iso.date().optional(),
}).and(termsSchema);

export const pauseSubscriptionSchema = z.object({
  resumes_at: z.iso.date().nullable().optional(),
});

export const cancelSubscriptionSchema = z.object({
  reason: z.string().trim().min(1).max(500).nullable().optional(),
});

export type Subscription = SubscriptionRow;
export type SubscriptionPlanVersion = SubscriptionPlanVersionRow;
export type SubscriptionPlanItem = SubscriptionPlanItemRow;
export type SubscriptionCycle = SubscriptionCycleRow;
export type SubscriptionEvent = SubscriptionEventRow;
export type SubscriptionPaymentMethod = SubscriptionPaymentMethodRow;
export type SubscriptionDunningAttempt = SubscriptionDunningAttemptRow;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type UpdateSubscriptionTermsInput = z.infer<typeof updateSubscriptionTermsSchema>;
export type PauseSubscriptionInput = z.infer<typeof pauseSubscriptionSchema>;
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;

export type SubscriptionSummary = {
  subscription_id: string;
  public_ref: string;
  company_id: string;
  company_name: string;
  client_profile_id: string | null;
  service_id: string;
  service_name: string;
  status: (typeof subscriptionStatuses)[number];
  health: (typeof subscriptionHealthStates)[number];
  paid_cycle_count: number;
  last_payment_at: string | null;
  next_payment_on: string | null;
  amount_cents: number;
  currency: string;
  interval_unit: (typeof subscriptionIntervalUnits)[number];
  interval_count: number;
};

export type SubscriptionDueWork = {
  subscription_id: string;
  cycle_id: string | null;
  work_type: "issue_invoice" | "reconcile" | "operator_action";
  due_at: string;
  reason: string;
};

export type SubscriptionCapabilities = {
  view: boolean;
  manage: boolean;
  pause: boolean;
  cancel: boolean;
  billing: boolean;
};

export type SubscriptionDetailCycle = Pick<
  SubscriptionCycleRow,
  | "id"
  | "sequence"
  | "period_start"
  | "period_end"
  | "due_on"
  | "issue_on"
  | "status"
  | "invoice_id"
  | "generated_at"
  | "settled_at"
  | "fulfillment_status"
>;

export type SubscriptionDetail = {
  subscription: SubscriptionRow;
  current_plan: SubscriptionPlanVersionRow;
  plan_items: SubscriptionPlanItemRow[];
  cycles: SubscriptionDetailCycle[];
  events: SubscriptionEventRow[];
};
