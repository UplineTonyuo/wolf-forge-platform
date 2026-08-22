import { z } from "zod";
import type { WfCardMembershipRow } from "../../lib/supabase/database-rows";
import { uuidSchema } from "../shared";

export const wfCardMembershipStatuses = [
  "inactive",
  "pending",
  "active",
  "cancelled",
] as const;

export type WfCardMembershipStatus = (typeof wfCardMembershipStatuses)[number];
export type WfCardMembership = Omit<WfCardMembershipRow, "status"> & {
  status: WfCardMembershipStatus;
};

export type WfCardOffer = {
  membershipPriceCents: number;
  membershipCurrency: string;
};

export type WfCardPaymentResult = {
  paymentId: string;
  walletTransactionId: string;
  walletBalanceCents: number;
  invoiceBalanceCents: number;
};

export const payInvoiceWithWfCardSchema = z.object({
  request_id: uuidSchema,
  invoice_id: uuidSchema,
});

export type PayInvoiceWithWfCardInput = z.infer<typeof payInvoiceWithWfCardSchema>;

export const purchaseServiceWithBalanceSchema = z.object({
  request_id: uuidSchema,
  service_id: uuidSchema,
});

export type PurchaseServiceWithBalanceInput = z.infer<
  typeof purchaseServiceWithBalanceSchema
>;

/**
 * What the database returns for a completed purchase. Every figure here is the
 * server's: the amount is the catalogue price it charged, and the balance is the
 * wallet after the debit it performed.
 */
export type StorePurchaseResult = {
  orderId: string;
  orderNumber: number;
  ticketId: string;
  ticketPublicRef: string;
  invoiceId: string;
  invoiceNumber: number | null;
  paymentId: string;
  amountCents: number;
  currency: string;
  walletBalanceCents: number;
  serviceName: string;
  /** True when this request id had already succeeded and nothing new was made. */
  replayed: boolean;
};

export const setWfCardMembershipSchema = z.object({
  request_id: uuidSchema,
  company_id: uuidSchema,
  active: z.boolean(),
});

export type SetWfCardMembershipInput = z.infer<typeof setWfCardMembershipSchema>;
