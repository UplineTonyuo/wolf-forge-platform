"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { toClientSafeError } from "../../lib/errors/application-error";
import { parseSubscriptionFormData } from "../../lib/subscriptions/form-data";
import { getClientContext, getInternalContext } from "../../lib/supabase/next-server";

export async function loadSubscriptionVisibilityAction(audience: "internal" | "client"): Promise<
  { ok: true; ids: string[]; states: string[]; workEnabled: boolean } | { ok: false; denied: boolean }
> {
  try {
    const context = audience === "client" ? await getClientContext() : await getInternalContext();
    const rows = await context.services.subscriptions.list();
    const workEnabled = await context.services.subscriptions.workEnabled();
    return { ok: true, ids: rows.map((row) => row.subscription_id), states: rows.map((row) => `${row.subscription_id}:${row.status}`), workEnabled };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, denied: ["PERMISSION_DENIED", "NOT_FOUND"].includes(toClientSafeError(error).code) };
  }
}

export type SubscriptionActionState = {
  error: string | null;
  fieldErrors: Record<string, string>;
};

export type SubscriptionMutationResult = { ok: true } | { ok: false; error: string };

function actionError(error: unknown): SubscriptionActionState {
  return { error: toClientSafeError(error).message, fieldErrors: {} };
}

function mutationError(error: unknown): SubscriptionMutationResult {
  return { ok: false, error: toClientSafeError(error).message };
}

export async function createSubscriptionAction(
  _state: SubscriptionActionState,
  formData: FormData,
): Promise<SubscriptionActionState> {
  void _state;
  const parsed = parseSubscriptionFormData(formData);
  if (!parsed.success) return { error: "Check the highlighted Subscription fields.", fieldErrors: parsed.fieldErrors };

  const context = await getInternalContext();
  if (!context.user.subscriptions.manage) return { error: "You do not have permission to create Subscriptions.", fieldErrors: {} };
  if (!parsed.data.company_id || !parsed.data.billing_anchor) return { error: "Choose a client and billing anchor.", fieldErrors: {} };

  let subscriptionId: string;
  try {
    const service = await context.services.catalog.get(parsed.data.service_id);
    const subscription = await context.services.subscriptions.create({
      request_id: parsed.data.request_id,
      company_id: parsed.data.company_id,
      client_profile_id: null,
      service_id: service.id,
      plan_source: "admin_invoice",
      billing_anchor: parsed.data.billing_anchor,
      interval_unit: parsed.data.interval_unit,
      interval_count: parsed.data.interval_count,
      end_of_month_policy: parsed.data.end_of_month_policy,
      currency: parsed.data.currency,
      lead_days: parsed.data.lead_days,
      grace_days: parsed.data.grace_days,
      recurring_action: parsed.data.recurring_action,
      request_limit_total: parsed.data.request_limit_total,
      request_limit_active: parsed.data.request_limit_active,
      items: [{
        service_id: service.id,
        name: service.name,
        description: service.description,
        quantity: parsed.data.quantity,
        unit_amount_cents: parsed.data.unit_amount_cents,
        unit_discount_cents: parsed.data.unit_discount_cents,
        coupon_id: null,
        is_taxable: parsed.data.is_taxable,
      }],
    }, context.actor);
    subscriptionId = subscription.id;
  } catch (error) {
    return actionError(error);
  }

  revalidatePath("/subscriptions");
  redirect(`/subscriptions/${subscriptionId}?created=1`);
}

export async function updateSubscriptionTermsAction(
  subscriptionId: string,
  _state: SubscriptionActionState,
  formData: FormData,
): Promise<SubscriptionActionState> {
  void _state;
  const parsed = parseSubscriptionFormData(formData);
  if (!parsed.success) return { error: "Check the highlighted plan fields.", fieldErrors: parsed.fieldErrors };

  const context = await getInternalContext();
  if (!context.user.subscriptions.manage) return { error: "You do not have permission to change Subscription plans.", fieldErrors: {} };

  try {
    const service = await context.services.catalog.get(parsed.data.service_id);
    await context.services.subscriptions.updateTerms(subscriptionId, {
      request_id: parsed.data.request_id,
      effective_from: parsed.data.effective_from,
      interval_unit: parsed.data.interval_unit,
      interval_count: parsed.data.interval_count,
      end_of_month_policy: parsed.data.end_of_month_policy,
      currency: parsed.data.currency,
      lead_days: parsed.data.lead_days,
      grace_days: parsed.data.grace_days,
      recurring_action: parsed.data.recurring_action,
      request_limit_total: parsed.data.request_limit_total,
      request_limit_active: parsed.data.request_limit_active,
      items: [{
        service_id: service.id,
        name: service.name,
        description: service.description,
        quantity: parsed.data.quantity,
        unit_amount_cents: parsed.data.unit_amount_cents,
        unit_discount_cents: parsed.data.unit_discount_cents,
        coupon_id: null,
        is_taxable: parsed.data.is_taxable,
      }],
    }, context.actor);
  } catch (error) {
    return actionError(error);
  }

  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions/${subscriptionId}`);
  redirect(`/subscriptions/${subscriptionId}?saved=1`);
}

export async function pauseSubscriptionAction(subscriptionId: string, resumesAt: string | null): Promise<SubscriptionMutationResult> {
  const context = await getInternalContext();
  if (!context.user.subscriptions.pause) return { ok: false, error: "You do not have permission to pause Subscriptions." };
  try {
    await context.services.subscriptions.pause(subscriptionId, { resumes_at: resumesAt || null }, context.actor);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions/${subscriptionId}`);
  return { ok: true };
}

export async function resumeSubscriptionAction(subscriptionId: string): Promise<SubscriptionMutationResult> {
  const context = await getInternalContext();
  if (!context.user.subscriptions.pause) return { ok: false, error: "You do not have permission to resume Subscriptions." };
  try {
    await context.services.subscriptions.resume(subscriptionId, context.actor);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions/${subscriptionId}`);
  return { ok: true };
}

export async function scheduleSubscriptionCancellationAction(subscriptionId: string, reason: string): Promise<SubscriptionMutationResult> {
  const context = await getInternalContext();
  if (!context.user.subscriptions.cancel) return { ok: false, error: "You do not have permission to cancel Subscriptions." };
  try {
    await context.services.subscriptions.scheduleCancellation(subscriptionId, { reason: reason.trim() || null }, context.actor);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions/${subscriptionId}`);
  return { ok: true };
}

export async function removeSubscriptionCancellationAction(subscriptionId: string): Promise<SubscriptionMutationResult> {
  const context = await getInternalContext();
  if (!context.user.subscriptions.cancel) return { ok: false, error: "You do not have permission to change cancellation settings." };
  try {
    await context.services.subscriptions.removeCancellation(subscriptionId, context.actor);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions/${subscriptionId}`);
  return { ok: true };
}

export async function cancelSubscriptionAction(subscriptionId: string, reason: string): Promise<SubscriptionMutationResult> {
  const context = await getInternalContext();
  if (!context.user.subscriptions.cancel) return { ok: false, error: "You do not have permission to cancel Subscriptions." };
  try {
    await context.services.subscriptions.cancel(subscriptionId, { reason: reason.trim() || null }, context.actor);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions/${subscriptionId}`);
  return { ok: true };
}
