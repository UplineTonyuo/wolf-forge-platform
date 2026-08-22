"use server";

import { revalidatePath } from "next/cache";
import { toClientSafeError } from "../../lib/errors/application-error";
import { getClientContext, getInternalContext } from "../../lib/supabase/next-server";

/**
 * The Store purchase boundary.
 *
 * This action forwards two stable identifiers and reads a result. It does not
 * price anything, does not touch a wallet, and does not create an Order or a
 * Ticket — all of that happens inside one database transaction, which is the
 * only place it can happen atomically. If this file ever grows a "then create
 * the ticket" step, the Golden Rule has been broken.
 */

export type StorePurchaseActionResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: number;
      ticketId: string;
      ticketPublicRef: string;
      amountCents: number;
      currency: string;
      walletBalanceCents: number;
      serviceName: string;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | "MEMBERSHIP_REQUIRED"
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
    revalidatePath("/account/messages");
    revalidatePath("/account/store");
    revalidatePath(`/account/store/${input.serviceId}`);

    return {
      ok: true,
      orderId: purchase.orderId,
      orderNumber: purchase.orderNumber,
      ticketId: purchase.ticketId,
      ticketPublicRef: purchase.ticketPublicRef,
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

    if (raw.includes("WF_CARD_MEMBERSHIP_REQUIRED")) {
      return {
        ok: false,
        code: "MEMBERSHIP_REQUIRED",
        error: "An active WF Card membership is required to pay from your Wolf Forge Balance.",
      };
    }
    if (raw.includes("WF_CARD_INSUFFICIENT_BALANCE")) {
      return {
        ok: false,
        code: "INSUFFICIENT_BALANCE",
        error: "Your Wolf Forge Balance no longer covers this investment.",
      };
    }
    if (raw.includes("WF_PURCHASE_RECURRING_UNSUPPORTED")) {
      return {
        ok: false,
        code: "RECURRING_UNSUPPORTED",
        error: "Recurring investments are arranged with your Wolf Forge team.",
      };
    }
    if (raw.includes("WF_PURCHASE_SERVICE_NOT_PRICED")) {
      return {
        ok: false,
        code: "NOT_PRICED",
        error: "This investment is priced with your Wolf Forge team.",
      };
    }
    if (raw.includes("WF_PURCHASE_SERVICE_UNAVAILABLE")) {
      return {
        ok: false,
        code: "SERVICE_UNAVAILABLE",
        error: "This investment is not available to purchase right now.",
      };
    }
    if (raw.includes("rate limit") || raw.includes("RATE_LIMIT")) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        error: "Too many purchase attempts. Please try again shortly.",
      };
    }

    return {
      ok: false,
      code: "PURCHASE_FAILED",
      error: toClientSafeError(error).message,
    };
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
    return { ok: false, error: toClientSafeError(error).message };
  }
}
