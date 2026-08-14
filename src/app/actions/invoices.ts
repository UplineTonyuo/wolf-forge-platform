"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { invoicePaymentInputSchema, invoiceRefundInputSchema } from "../../domain/invoices/schema";
import { toClientSafeError } from "../../lib/errors/application-error";
import { parseInput } from "../../domain/shared";
import { parseInvoiceFormData, parseIssuedInvoiceFormData, parseMoneyToCents } from "../../lib/invoices/form-data";
import { getInternalContext } from "../../lib/supabase/next-server";

export type InvoiceActionState = {
  error: string | null;
  fieldErrors: Record<string, string>;
};

export type InvoiceMutationResult = { ok: true } | { ok: false; error: string };

function denied(message: string): InvoiceActionState {
  return { error: message, fieldErrors: {} };
}

function actionError(error: unknown): InvoiceActionState {
  const safe = toClientSafeError(error);
  return { error: safe.message, fieldErrors: {} };
}

function mutationError(error: unknown): InvoiceMutationResult {
  return { ok: false, error: toClientSafeError(error).message };
}

export async function createInvoiceAction(
  _state: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  void _state;
  const parsed = parseInvoiceFormData(formData);
  if (!parsed.success) return { error: "Check the highlighted invoice fields.", fieldErrors: parsed.fieldErrors };
  const context = await getInternalContext();
  if (!context.user.invoices.manage) return denied("You do not have permission to create invoices.");

  let invoiceId: string;
  try {
    const invoice = await context.services.invoices.create({
      ...parsed.data,
      request_id: String(formData.get("request_id") ?? ""),
    }, context.actor);
    invoiceId = invoice.id;
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/invoices");
  redirect(`/invoices/${invoiceId}?created=1`);
}

export async function updateInvoiceAction(
  invoiceId: string,
  _state: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  void _state;
  const context = await getInternalContext();
  if (!context.user.invoices.manage) return denied("You do not have permission to edit invoices.");

  try {
    const current = await context.services.invoices.get(invoiceId);
    const issued = current.invoice.status !== "draft";
    const parsed = issued ? parseIssuedInvoiceFormData(formData) : parseInvoiceFormData(formData);
    if (!parsed.success) return { error: "Check the highlighted invoice fields.", fieldErrors: parsed.fieldErrors };
    await context.services.invoices.update(invoiceId, parsed.data, context.actor, issued);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/invoices/${invoiceId}?saved=1`);
}

export async function issueInvoiceAction(invoiceId: string): Promise<InvoiceMutationResult> {
  const context = await getInternalContext();
  if (!context.user.invoices.manage) return { ok: false, error: "You do not have permission to issue invoices." };
  try {
    await context.services.invoices.issue(invoiceId, context.actor);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true };
}

export async function recordInvoicePaymentAction(
  invoiceId: string,
  amount: string,
  paymentMethod: string,
  requestId: string,
): Promise<InvoiceMutationResult> {
  const context = await getInternalContext();
  if (!context.user.invoices.markPaid) return { ok: false, error: "You do not have permission to record invoice payments." };
  const amountCents = parseMoneyToCents(amount);
  if (!amountCents) return { ok: false, error: "Enter a valid payment amount." };
  try {
    const input = parseInput(invoicePaymentInputSchema, {
      request_id: requestId,
      amount_cents: amountCents,
      payment_method: paymentMethod,
    });
    const detail = await context.services.invoices.get(invoiceId);
    if (input.amount_cents > detail.financials.balance_due_cents) {
      return { ok: false, error: "Payment cannot exceed the remaining balance." };
    }
    await context.services.invoices.recordPayment(invoiceId, input, context.actor);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true };
}

export async function refundInvoiceAction(
  invoiceId: string,
  amount: string,
  reason: string,
  requestId: string,
): Promise<InvoiceMutationResult> {
  const context = await getInternalContext();
  if (!context.user.invoices.refund) return { ok: false, error: "You do not have permission to refund invoices." };
  const amountCents = parseMoneyToCents(amount);
  if (!amountCents) return { ok: false, error: "Enter a valid refund amount." };
  try {
    const input = parseInput(invoiceRefundInputSchema, {
      request_id: requestId,
      amount_cents: amountCents,
      reason,
    });
    const detail = await context.services.invoices.get(invoiceId);
    const refundable = detail.financials.gross_paid_cents - detail.financials.successful_refunds_cents;
    if (input.amount_cents > refundable) return { ok: false, error: "Refund cannot exceed the refundable amount." };
    await context.services.invoices.refund(invoiceId, input, context.actor);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true };
}

export async function voidInvoiceAction(invoiceId: string): Promise<InvoiceMutationResult> {
  const context = await getInternalContext();
  if (!context.user.invoices.void) return { ok: false, error: "You do not have permission to void invoices." };
  try {
    await context.services.invoices.void(invoiceId, context.actor);
  } catch (error) {
    return mutationError(error);
  }
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true };
}
