import type {
  PayInvoiceWithWfCardInput,
  PurchaseServiceWithBalanceInput,
  SetWfCardMembershipInput,
  StorePurchaseResult,
  WfCardMembership,
  WfCardOffer,
  WfCardPaymentResult,
} from "../domain/wf-card/schema";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type { UserMutationClient } from "./types";

export class WfCardRepository {
  constructor(private readonly client: UserMutationClient) {}

  async getMembership(companyId: string): Promise<WfCardMembership | null> {
    const result = await this.client
      .from("wf_card_memberships")
      .select()
      .eq("company_id", companyId)
      .maybeSingle();

    if (result.error) throw mapDatabaseError(result.error, "WF Card membership");
    return result.data as WfCardMembership | null;
  }

  async getOffer(): Promise<WfCardOffer> {
    const result = await this.client.rpc("app_get_wf_card_settings");
    if (result.error) throw mapDatabaseError(result.error, "WF Card offer");
    const offer = result.data?.[0];
    if (!offer) throw mapDatabaseError({ code: "PGRST116" }, "WF Card offer");

    return {
      membershipPriceCents: offer.membership_price_cents,
      membershipCurrency: offer.membership_currency,
    };
  }

  async payInvoice(input: PayInvoiceWithWfCardInput): Promise<WfCardPaymentResult> {
    const result = await this.client.rpc("app_pay_invoice_with_wallet", {
      p_request_id: input.request_id,
      p_invoice_id: input.invoice_id,
    });

    if (result.error) throw mapDatabaseError(result.error, "WF Card payment");
    const payment = result.data?.[0];
    if (!payment) throw mapDatabaseError({ code: "PGRST116" }, "WF Card payment");

    return {
      paymentId: payment.payment_id,
      walletTransactionId: payment.wallet_transaction_id,
      walletBalanceCents: payment.wallet_balance_cents,
      invoiceBalanceCents: payment.invoice_balance_cents,
    };
  }

  /**
   * The whole Store purchase, in one round trip to one transaction.
   *
   * The repository sends a service id and a request id and nothing else. Price,
   * company, balance and every authorization decision are resolved inside the
   * database, so there is no field here through which a browser could influence
   * what it is charged or what it receives.
   */
  async purchaseServiceWithBalance(
    input: PurchaseServiceWithBalanceInput,
  ): Promise<StorePurchaseResult> {
    const result = await this.client.rpc("app_purchase_service_with_balance", {
      p_request_id: input.request_id,
      p_service_id: input.service_id,
    });

    if (result.error) throw mapDatabaseError(result.error, "Service purchase");
    const purchase = result.data?.[0];
    if (!purchase) throw mapDatabaseError({ code: "PGRST116" }, "Service purchase");

    return {
      orderId: purchase.order_id,
      orderNumber: purchase.order_number,
      ticketId: purchase.ticket_id,
      ticketPublicRef: purchase.ticket_public_ref,
      invoiceId: purchase.invoice_id,
      invoiceNumber: purchase.invoice_number,
      paymentId: purchase.payment_id,
      amountCents: purchase.amount_cents,
      currency: purchase.currency,
      walletBalanceCents: purchase.wallet_balance_cents,
      serviceName: purchase.service_name,
      replayed: purchase.replayed,
    };
  }

  /** Internal only. The database re-checks invoices.manage and the actor. */
  async setMembership(input: SetWfCardMembershipInput): Promise<WfCardMembership> {
    const result = await this.client.rpc("app_set_wf_card_membership", {
      p_request_id: input.request_id,
      p_company_id: input.company_id,
      p_active: input.active,
    });

    if (result.error) throw mapDatabaseError(result.error, "WF Card membership");
    return result.data as unknown as WfCardMembership;
  }
}
