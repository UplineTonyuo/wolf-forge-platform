import type {
  PayInvoiceWithWfCardInput,
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
}
