import type { z } from "zod";
import { couponPayloadSchema, type CouponPayload } from "../../domain/coupons/schema";

export type CouponFormValidation =
  | { success: true; data: CouponPayload }
  | { success: false; fieldErrors: Record<string, string> };

function nullableText(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function optionalNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text === "" ? Number.NaN : Number(text);
}

function parseRules(value: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(String(value ?? "[]"));
  } catch {
    return null;
  }
}

function issuesToFieldErrors(issues: z.core.$ZodIssue[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "form";
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

export function parseCouponFormData(formData: FormData): CouponFormValidation {
  const setExpiry = formData.get("set_expiry") === "on";
  const setMinimum = formData.get("set_minimum_cart") === "on";
  const result = couponPayloadSchema.safeParse({
    code: String(formData.get("code") ?? ""),
    description: nullableText(formData.get("description")),
    discount_type: String(formData.get("discount_type") ?? ""),
    recurring_duration: String(formData.get("recurring_duration") ?? ""),
    single_use_per_customer: formData.get("single_use_per_customer") === "on",
    new_customers_only: formData.get("new_customers_only") === "on",
    expires_at: setExpiry ? String(formData.get("expires_at") ?? "") : null,
    minimum_cart_amount: setMinimum ? optionalNumber(formData.get("minimum_cart_amount")) : null,
    is_active: formData.get("is_active") === "on",
    rules: parseRules(formData.get("rules")),
  });

  if (!result.success) {
    return { success: false, fieldErrors: issuesToFieldErrors(result.error.issues) };
  }
  return { success: true, data: result.data };
}
