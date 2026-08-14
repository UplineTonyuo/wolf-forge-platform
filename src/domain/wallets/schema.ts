import { z } from "zod";
import type {
  CompanyWalletRow,
  CompanyWalletTransactionRow,
} from "../../lib/supabase/database-rows";
import {
  uuidSchema,
} from "../shared";

export type CompanyWallet =
  CompanyWalletRow;

export type CompanyWalletTransaction =
  CompanyWalletTransactionRow;

export const adjustCompanyBalanceSchema =
  z.object({
    request_id: uuidSchema.optional(),
    company_id: uuidSchema,

    amount_cents: z
      .number()
      .int()
      .safe()
      .refine(
        (value) => value !== 0,
        "Balance adjustment must be non-zero.",
      ),

    reason: z
      .string()
      .trim()
      .max(240)
      .nullable()
      .optional(),
  });

export type AdjustCompanyBalanceInput =
  z.infer<
    typeof adjustCompanyBalanceSchema
  >;