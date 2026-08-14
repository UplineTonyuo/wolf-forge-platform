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
