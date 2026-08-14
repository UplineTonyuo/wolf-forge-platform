import { z } from "zod";
import type { CouponRow } from "../../lib/supabase/database-rows";
import { uuidSchema } from "../shared";

export const couponDiscountTypes = ["fixed", "percentage"] as const;
export const couponRecurringDurations = ["forever", "first_payment"] as const;

const exactMoneySchema = z.number().finite().nonnegative().max(9_999_999_999.99).refine(
  (value) => Number.isInteger(value * 100),
  "Use no more than two decimal places.",
);

export const couponRuleSchema = z.object({
  discount_value: exactMoneySchema,
  applies_to_all: z.boolean(),
  service_ids: z.array(uuidSchema),
}).superRefine((rule, context) => {
  if (rule.applies_to_all && rule.service_ids.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["service_ids"],
      message: "All Services rules cannot include selected Services.",
    });
  }

  if (!rule.applies_to_all && rule.service_ids.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["service_ids"],
      message: "Select at least one Service.",
    });
  }

  if (new Set(rule.service_ids).size !== rule.service_ids.length) {
    context.addIssue({
      code: "custom",
      path: ["service_ids"],
      message: "A Service can only be selected once per rule.",
    });
  }
});

export const couponPayloadSchema = z.object({
  code: z.string().trim().min(1, "Enter a coupon code.").max(128).transform((value) => value.toUpperCase()),
  description: z.string().trim().min(1).nullable(),
  discount_type: z.enum(couponDiscountTypes),
  recurring_duration: z.enum(couponRecurringDurations),
  single_use_per_customer: z.boolean(),
  new_customers_only: z.boolean(),
  expires_at: z.iso.datetime({ offset: true }).nullable(),
  minimum_cart_amount: exactMoneySchema.nullable(),
  is_active: z.boolean(),
  rules: z.array(couponRuleSchema).min(1, "Add at least one discount rule."),
}).superRefine((coupon, context) => {
  if (coupon.discount_type !== "percentage") return;

  coupon.rules.forEach((rule, index) => {
    if (rule.discount_value <= 0 || rule.discount_value > 100) {
      context.addIssue({
        code: "custom",
        path: ["rules", index, "discount_value"],
        message: "Percentage discounts must be greater than 0 and at most 100.",
      });
    }
  });
});

export const createCouponSchema = couponPayloadSchema.extend({ request_id: uuidSchema });

export type Coupon = CouponRow;
export type CouponPayload = z.infer<typeof couponPayloadSchema>;
export type CreateCouponInput = z.infer<typeof createCouponSchema>;
