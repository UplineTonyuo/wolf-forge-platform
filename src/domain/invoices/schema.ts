import { z } from "zod";
import type {
  InvoiceItemRow,
  InvoicePaymentRow,
  InvoiceRefundRow,
  InvoiceRow,
} from "../../lib/supabase/database-rows";
import { uuidSchema } from "../shared";

export const invoiceStatuses = ["draft", "unpaid", "payment_pending", "paid", "void"] as const;
export const invoicePresentationStates = [
  "draft",
  "unpaid",
  "overdue",
  "payment_pending",
  "paid",
  "partially_refunded",
  "refunded",
  "void",
] as const;
export const invoiceBillingReasons = [
  "manual",
  "subscription_create",
  "subscription_cycle",
  "subscription_update",
  "subscription_threshold",
] as const;
export const invoicePaymentStatuses = ["pending", "succeeded", "failed", "cancelled"] as const;
export const invoicePaymentMethods = [
  "manual",
  "bank_transfer",
  "wallet",
  "wolf_forge_wallet",
  "other",
] as const;

const centsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const optionalTextSchema = z.string().trim().max(2_000).nullable();

export const invoiceItemInputSchema = z.object({
  service_id: uuidSchema.nullable(),
  name: z.string().trim().min(1, "Enter an item name.").max(500),
  description: optionalTextSchema,
  quantity: z.number().int().positive().max(1_000_000),
  unit_price_cents: centsSchema,
  unit_discount_cents: centsSchema,
  is_taxable: z.boolean(),
}).refine(
  (item) => item.unit_discount_cents <= item.unit_price_cents,
  { path: ["unit_discount_cents"], message: "Discount cannot exceed unit price." },
);

export const invoicePayloadSchema = z.object({
  company_id: uuidSchema,
  client_profile_id: uuidSchema.nullable(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/u, "Use a three-letter currency code."),
  billing_reason: z.enum(invoiceBillingReasons).nullable(),
  due_at: z.iso.datetime({ offset: true }).nullable(),
  tax_total_cents: centsSchema,
  items: z.array(invoiceItemInputSchema).min(1, "Add at least one invoice item.").max(100),
});

export const createInvoiceSchema = invoicePayloadSchema.extend({ request_id: uuidSchema });
export const issuedInvoiceUpdateSchema = z.object({
  billing_reason: z.enum(invoiceBillingReasons).nullable(),
  due_at: z.iso.datetime({ offset: true }).nullable(),
});
export const invoicePaymentInputSchema = z.object({
  request_id: uuidSchema,
  amount_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  payment_method: z.enum(invoicePaymentMethods),
});
export const invoiceRefundInputSchema = z.object({
  request_id: uuidSchema,
  amount_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: z.string().trim().min(1, "Enter a refund reason.").max(500),
});

export type InvoiceStatus = (typeof invoiceStatuses)[number];
export type InvoicePresentationState = (typeof invoicePresentationStates)[number];
export type InvoicePaymentStatus = (typeof invoicePaymentStatuses)[number];
export type InvoicePaymentMethod = (typeof invoicePaymentMethods)[number];
export type InvoicePayload = z.infer<typeof invoicePayloadSchema>;
export type IssuedInvoiceUpdate = z.infer<typeof issuedInvoiceUpdateSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type InvoicePaymentInput = z.infer<typeof invoicePaymentInputSchema>;
export type InvoiceRefundInput = z.infer<typeof invoiceRefundInputSchema>;
export type Invoice = InvoiceRow;
export type InvoiceItem = InvoiceItemRow;
export type InvoicePayment = InvoicePaymentRow;
export type InvoiceRefund = InvoiceRefundRow;

export type InvoiceFinancials = {
  invoice_id: string;
  persisted_status: InvoiceStatus;
  presentation_state: InvoicePresentationState;
  gross_paid_cents: number;
  successful_refunds_cents: number;
  net_paid_cents: number;
  balance_due_cents: number;
  is_overdue: boolean;
};

export type InvoiceCapabilities = {
  view: boolean;
  manage: boolean;
  markPaid: boolean;
  void: boolean;
  refund: boolean;
};
