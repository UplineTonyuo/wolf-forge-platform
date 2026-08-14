"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toClientSafeError } from "../../lib/errors/application-error";
import { parseCouponFormData } from "../../lib/coupons/form-data";
import { getInternalContext } from "../../lib/supabase/next-server";

export type CouponActionState = {
  error: string | null;
  fieldErrors: Record<string, string>;
};

const deniedState: CouponActionState = {
  error: "You do not have permission to manage Coupons.",
  fieldErrors: {},
};

function actionError(error: unknown): CouponActionState {
  const safe = toClientSafeError(error);
  if (safe.code === "CONFLICT") {
    return { error: "That coupon code is already in use.", fieldErrors: { code: "Choose a unique coupon code." } };
  }
  if (safe.code === "VALIDATION_ERROR") {
    return { error: "Check the coupon settings and try again.", fieldErrors: {} };
  }
  return { error: safe.message, fieldErrors: {} };
}

export async function createCouponAction(
  _state: CouponActionState,
  formData: FormData,
): Promise<CouponActionState> {
  void _state;
  const parsed = parseCouponFormData(formData);
  if (!parsed.success) {
    return { error: "Check the highlighted coupon settings.", fieldErrors: parsed.fieldErrors };
  }

  const context = await getInternalContext();
  if (!context.user.canManageCoupons) return deniedState;

  try {
    await context.services.coupons.create({
      ...parsed.data,
      request_id: String(formData.get("request_id") ?? ""),
    }, context.actor);
  } catch (error) {
    return actionError(error);
  }

  revalidatePath("/coupons");
  redirect("/coupons?created=1");
}

export async function updateCouponAction(
  couponId: string,
  _state: CouponActionState,
  formData: FormData,
): Promise<CouponActionState> {
  void _state;
  const parsed = parseCouponFormData(formData);
  if (!parsed.success) {
    return { error: "Check the highlighted coupon settings.", fieldErrors: parsed.fieldErrors };
  }

  const context = await getInternalContext();
  if (!context.user.canManageCoupons) return deniedState;

  try {
    await context.services.coupons.update(couponId, parsed.data, context.actor);
  } catch (error) {
    return actionError(error);
  }

  revalidatePath("/coupons");
  revalidatePath(`/coupons/${couponId}`);
  redirect(`/coupons/${couponId}?saved=1`);
}

export async function archiveCouponAction(
  couponId: string,
  _state: CouponActionState,
  _formData: FormData,
): Promise<CouponActionState> {
  void _state;
  void _formData;
  const context = await getInternalContext();
  if (!context.user.canManageCoupons) return deniedState;

  try {
    await context.services.coupons.archive(couponId, context.actor);
  } catch (error) {
    return actionError(error);
  }

  revalidatePath("/coupons");
  redirect("/coupons?archived=1");
}
