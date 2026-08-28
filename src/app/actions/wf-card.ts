"use server";

import { revalidatePath } from "next/cache";
import { observeActionFailure } from "../../lib/security/observed-failure";
import { currentCorrelationId } from "../../lib/security/request-correlation";
import { recordSecurityEvent } from "../../lib/security/security-log";
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

    /*
     * Security C2-4. Wallet settlement is the one client-reachable path that
     * moves money, so its three modelled refusals are recorded as EXPECTED
     * economic denials rather than being invisible, and anything else falls
     * through to a system-classified failure.
     *
     * The invoice id is a server-checked UUID and is safe to record; no amount,
     * no balance and nothing the browser supplied about the economics is
     * logged, because the authoritative figures live in the transaction that
     * just rolled back (§I).
     */
    const denial = rawMessage.includes("WF_CARD_MEMBERSHIP_REQUIRED")
      ? ({ code: "MEMBERSHIP_REQUIRED", reason: "membership_required", error: "An active WF Card membership is required." } as const)
      : rawMessage.includes("WF_CARD_INSUFFICIENT_BALANCE")
        ? ({ code: "INSUFFICIENT_BALANCE", reason: "insufficient_balance", error: "Your WF Card balance is no longer sufficient for this invoice." } as const)
        : rawMessage.includes("WF_CARD_INVOICE_NOT_COLLECTIBLE")
          ? ({ code: "NOT_COLLECTIBLE", reason: "invoice_not_collectible", error: "This invoice is no longer open for payment." } as const)
          : null;

    if (denial) {
      recordSecurityEvent({
        event: "economic.payment.denied",
        correlationId: await currentCorrelationId(),
        actorId: context.actor.id,
        actorClass: "client",
        resourceType: "invoice",
        resourceId: invoiceId,
        outcome: "denied",
        failureClass: "expected",
        metadata: { action: "invoice.pay_with_wallet", reason: denial.reason },
      });
      return { ok: false, code: denial.code, error: denial.error };
    }

    /*
     * `app_pay_invoice_with_wallet` carries a C2-3 throttle
     * (`invoice.pay.actor.*`), so a WF429 arrives here as RATE_LIMITED and
     * `observeActionFailure` files it as `abuse.rate_limited` — naming the
     * action and never the bucket.
     */
    const safe = await observeActionFailure(error, {
      action: "invoice.pay_with_wallet",
      actorId: context.actor.id,
      actorClass: "client",
      resourceType: "invoice",
      resourceId: invoiceId,
      systemEvent: "economic.payment.failed",
    });

    return { ok: false, code: "PAYMENT_FAILED", error: safe.message };
  }
}
