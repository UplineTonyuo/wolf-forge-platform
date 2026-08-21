"use server";

import { revalidatePath } from "next/cache";
import { toClientSafeError } from "../../lib/errors/application-error";
import { getClientContext } from "../../lib/supabase/next-server";

export type WfCardPaymentActionResult =
  | {
      ok: true;
      walletBalanceCents: number;
      invoiceBalanceCents: number;
    }
  | {
      ok: false;
      code:
        | "MEMBERSHIP_REQUIRED"
        | "INSUFFICIENT_BALANCE"
        | "NOT_COLLECTIBLE"
        | "PAYMENT_FAILED";
      error: string;
    };

export async function payInvoiceWithWfCardAction(
  invoiceId: string,
  requestId: string,
): Promise<WfCardPaymentActionResult> {
  const context = await getClientContext();

  try {
    await context.services.permissions.requireModuleAccess("portal_invoices");

    const payment = await context.services.wfCard.payInvoice(
      { invoice_id: invoiceId, request_id: requestId },
      context.actor,
    );

    revalidatePath("/account/invoices");
    revalidatePath(`/account/invoices/${invoiceId}`);
    return {
      ok: true,
      walletBalanceCents: payment.walletBalanceCents,
      invoiceBalanceCents: payment.invoiceBalanceCents,
    };
  } catch (error) {
    const rawMessage = error instanceof Error
      ? `${error.message} ${JSON.stringify(error.cause ?? "")}`
      : "";

    if (rawMessage.includes("WF_CARD_MEMBERSHIP_REQUIRED")) {
      return {
        ok: false,
        code: "MEMBERSHIP_REQUIRED",
        error: "An active WF Card membership is required.",
      };
    }
    if (rawMessage.includes("WF_CARD_INSUFFICIENT_BALANCE")) {
      return {
        ok: false,
        code: "INSUFFICIENT_BALANCE",
        error: "Your WF Card balance is no longer sufficient for this invoice.",
      };
    }
    if (rawMessage.includes("WF_CARD_INVOICE_NOT_COLLECTIBLE")) {
      return {
        ok: false,
        code: "NOT_COLLECTIBLE",
        error: "This invoice is no longer open for payment.",
      };
    }

    return {
      ok: false,
      code: "PAYMENT_FAILED",
      error: toClientSafeError(error).message,
    };
  }
}
