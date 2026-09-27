"use server";

import { revalidatePath } from "next/cache";
import { observeActionFailure } from "../../lib/security/observed-failure";
import { currentCorrelationId } from "../../lib/security/request-correlation";
import { recordSecurityEvent } from "../../lib/security/security-log";
import { getClientContext, getInternalContext } from "../../lib/supabase/next-server";

/**
 * The Store purchase boundary.
 *
 * This action forwards two stable identifiers and reads a result. It does not
 * price anything, touch a wallet, or create the Project and its conversation.
 * Those operations happen atomically inside the database.
 */

export type StorePurchaseActionResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: number;
      amountCents: number;
      currency: string;
      walletBalanceCents: number;
      serviceName: string;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | "INSUFFICIENT_BALANCE"
        | "SERVICE_UNAVAILABLE"
        | "RECURRING_UNSUPPORTED"
        | "NOT_PRICED"
        | "RATE_LIMITED"
        | "PURCHASE_FAILED";
      error: string;
    };

export async function purchaseServiceWithBalanceAction(input: {
  serviceId: string;
  /**
   * Generated once by the browser when the client opens the confirmation, and
   * reused for every retry of THAT decision. The database treats it as the
   * identity of the purchase: replaying it returns the original sale rather than
   * making a second one.
   */
  requestId: string;
}): Promise<StorePurchaseActionResult> {
  const context = await getClientContext();

  try {
    await context.services.permissions.requireModuleAccess("portal_store");

    const purchase = await context.services.wfCard.purchaseServiceWithBalance(
      { request_id: input.requestId, service_id: input.serviceId },
      context.actor,
    );

    // The purchase touches four surfaces the client can see.
    revalidatePath("/account");
    revalidatePath("/account/projects");
    revalidatePath("/account/invoices");
    revalidatePath("/account/store");
    revalidatePath(`/account/store/${input.serviceId}`);

    return {
      ok: true,
      orderId: purchase.orderId,
      orderNumber: purchase.orderNumber,
      amountCents: purchase.amountCents,
      currency: purchase.currency,
      walletBalanceCents: purchase.walletBalanceCents,
      serviceName: purchase.serviceName,
      replayed: purchase.replayed,
    };
  } catch (error) {
    const raw =
      error instanceof Error
        ? `${error.message} ${JSON.stringify(error.cause ?? "")}`
        : "";

    /*
     * Security C2-4. The domain refusals below are EXPECTED — a balance that no
     * longer covers a purchase is the system working — so they get one
     * `economic.purchase.denied` at info severity with the domain reason, not
     * an error. What they must never do is look like a system failure: a store
     * that quietly refuses every purchase for a real reason and a store that is
     * broken need to be distinguishable in the log, and before this they were
     * not.
     *
     * Nothing browser-supplied is recorded as economic truth. The service id is
     * a server-validated UUID; no amount, balance or price is logged here,
     * because the only authoritative copy of those lives inside the database
     * transaction that just rolled back.
     */
    const denial = raw.includes("WF_CARD_INSUFFICIENT_BALANCE")
      ? ({ code: "INSUFFICIENT_BALANCE", reason: "insufficient_balance", error: "Your Wolf Forge Balance no longer covers this investment." } as const)
      : raw.includes("WF_PURCHASE_RECURRING_UNSUPPORTED")
        ? ({ code: "RECURRING_UNSUPPORTED", reason: "recurring_unsupported", error: "Recurring investments are arranged with your Wolf Forge team." } as const)
        : raw.includes("WF_PURCHASE_SERVICE_NOT_PRICED")
          ? ({ code: "NOT_PRICED", reason: "service_not_priced", error: "This investment is priced with your Wolf Forge team." } as const)
          : raw.includes("WF_PURCHASE_SERVICE_UNAVAILABLE")
            ? ({ code: "SERVICE_UNAVAILABLE", reason: "service_unavailable", error: "This investment is not available to purchase right now." } as const)
            : null;

    if (denial) {
      recordSecurityEvent({
        event: "economic.purchase.denied",
        correlationId: await currentCorrelationId(),
        actorId: context.actor.id,
        actorClass: "client",
        resourceType: "service",
        resourceId: input.serviceId,
        outcome: "denied",
        failureClass: "expected",
        metadata: { action: "store.purchase", reason: denial.reason },
      });
      return { ok: false, code: denial.code, error: denial.error };
    }

    if (raw.includes("rate limit") || raw.includes("RATE_LIMIT")) {
      recordSecurityEvent({
        event: "abuse.rate_limited",
        correlationId: await currentCorrelationId(),
        actorId: context.actor.id,
        actorClass: "client",
        resourceType: "service",
        resourceId: input.serviceId,
        outcome: "denied",
        failureClass: "security_signal",
        /* The action, never the bucket, scope, window or limit (§G). */
        metadata: { action: "store.purchase" },
      });
      return {
        ok: false,
        code: "RATE_LIMITED",
        error: "Too many purchase attempts. Please try again shortly.",
      };
    }

    const safe = await observeActionFailure(error, {
      action: "store.purchase",
      actorId: context.actor.id,
      actorClass: "client",
      resourceType: "service",
      resourceId: input.serviceId,
      systemEvent: "economic.purchase.failed",
      rateLimitEvent: "abuse.rate_limited",
    });

    return { ok: false, code: "PURCHASE_FAILED", error: safe.message };
  }
}

export type SetWfCardMembershipActionResult =
  | { ok: true; status: string }
  | { ok: false; error: string };

/**
 * Internal only. Grants or withdraws the WF Card entitlement that unlocks the
 * Wolf Forge Balance rail for a company. It takes no payment — see the RPC
 * comment — and the database independently re-checks invoices.manage.
 */
export async function setWfCardMembershipAction(input: {
  companyId: string;
  active: boolean;
  requestId: string;
}): Promise<SetWfCardMembershipActionResult> {
  try {
    const context = await getInternalContext();

    const membership = await context.services.wfCard.setMembership(
      {
        request_id: input.requestId,
        company_id: input.companyId,
        active: input.active,
      },
      context.actor,
    );

    revalidatePath(`/clients/${input.companyId}`);
    return { ok: true, status: membership.status };
  } catch (error) {
    /*
     * The entitlement that unlocks the Wolf Forge Balance rail. It moves no
     * money, but granting it is what makes spending possible, so a failure or a
     * capability refusal here is worth the same visibility as a payment.
     *
     * The actor is not available on every path — `getInternalContext()` itself
     * can redirect — so it is read defensively rather than assumed.
     */
    const safe = await observeActionFailure(error, {
      action: "wf_card.set_membership",
      actorClass: "internal",
      resourceType: "company",
      resourceId: input.companyId,
      systemEvent: "economic.payment.failed",
    });
    return { ok: false, error: safe.message };
  }
}
