import type {
  CreateInvoiceInput,
  InvoiceFinancials,
  InvoicePaymentInput,
  InvoicePayload,
  IssuedInvoiceUpdate,
  InvoiceRefundInput,
} from "../domain/invoices/schema";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type {
  ActivityEventRow,
  CompanyRow,
  InvoiceItemRow,
  InvoicePaymentRow,
  InvoiceRefundRow,
  InvoiceRow,
} from "../lib/supabase/database-rows";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";
import {
  invoiceManualPaymentSchema, invoiceManualSettingsSchema, invoiceShareLinkSchema,
  manualPaymentClaimSchema, manualPaymentReviewSchema, paymentReceiptSchema,
  type InvoiceManualSettings, type ManualPaymentClaimInput, type ManualPaymentReviewInput, type PaymentReceiptInput,
} from "../domain/invoices/manual-payments";
import { z } from "zod";

export type InvoiceSummary = {
  invoice: InvoiceRow;
  clientName: string;
  financials: InvoiceFinancials;
  paidAt: string | null;
};

const orderHistorySchema = z.object({
  order_ids: z.array(z.uuid()),
  shared_orders: z.array(z.object({ order_id: z.uuid(), invoice_item_id: z.uuid(), source_order_reference: z.string() })),
  payments: z.array(z.object({
    payment_id: z.uuid(),
    source_invoice_id: z.string(),
    source_provider: z.string(),
    source_payment_id: z.string(),
  })),
});

export type InvoiceDetail = {
  sourceHistory?: z.infer<typeof orderHistorySchema>;
  invoice: InvoiceRow;
  clientName: string;
  financials: InvoiceFinancials;
  items: InvoiceItemRow[];
  payments: InvoicePaymentRow[];
  refunds: InvoiceRefundRow[];
  activity: ActivityEventRow[];
};

export type ClientInvoiceSummary = {
  invoice: InvoiceRow;
  financials: InvoiceFinancials;
};

export type CompanyInvoiceSummary = ClientInvoiceSummary & Pick<InvoiceSummary, "paidAt">;

export type ClientInvoiceDetail = {
  invoice: InvoiceRow;
  clientName: string;
  financials: InvoiceFinancials;
  items: InvoiceItemRow[];
};

function asFinancials(value: {
  invoice_id: string;
  persisted_status: string;
  presentation_state: string;
  gross_paid_cents: number;
  successful_refunds_cents: number;
  net_paid_cents: number;
  balance_due_cents: number;
  is_overdue: boolean;
}): InvoiceFinancials {
  return value as InvoiceFinancials;
}

function latestSettledAt(payments: InvoicePaymentRow[], invoiceId: string) {
  return payments
    .filter((payment) => payment.invoice_id === invoiceId && payment.status === "succeeded" && payment.settled_at)
    .map((payment) => payment.settled_at as string)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

export class InvoiceRepository {
  async getManualPayment(id:string) {
    return invoiceManualPaymentSchema.parse(unwrapOne(await this.client.rpc("app_get_invoice_manual_payment",{p_invoice_id:id}),"Manual invoice payment"));
  }
  async getManualPaymentSettings() {
    return invoiceManualSettingsSchema.parse(unwrapOne(await this.client.rpc("app_get_invoice_manual_payment_settings"),"Manual payment settings"));
  }
  async saveManualPaymentSettings(input:InvoiceManualSettings) {
    return invoiceManualSettingsSchema.parse(unwrapOne(await this.client.rpc("app_save_invoice_manual_payment_settings",{p_enabled:input.enabled,p_paypal_url:input.paypal_url,p_instructions:input.instructions}),"Manual payment settings"));
  }
  async preparePaymentReceipt(id:string,input:PaymentReceiptInput) {
    return paymentReceiptSchema.parse(unwrapOne(await this.client.rpc("app_prepare_invoice_payment_receipt",{p_invoice_id:id,p_request_id:input.request_id,p_filename:input.filename,p_mime_type:input.mime_type,p_size_bytes:input.size_bytes,p_checksum_sha256:input.checksum_sha256}),"Payment receipt"));
  }
  async getPaymentReceipt(id:string) {
    return paymentReceiptSchema.parse(unwrapOne(await this.client.rpc("app_get_invoice_payment_receipt",{p_receipt_id:id}),"Payment receipt"));
  }
  async submitManualPaymentClaim(id:string,input:ManualPaymentClaimInput) {
    return manualPaymentClaimSchema.parse(unwrapOne(await this.client.rpc("app_submit_invoice_manual_payment_claim",{p_request_id:input.request_id,p_invoice_id:id,p_receipt_id:input.receipt_id,p_method:input.method,p_reference:input.reference,p_expected_balance_cents:input.expected_balance_cents}),"Payment report"));
  }
  async reviewManualPaymentClaim(id:string,input:ManualPaymentReviewInput) {
    return manualPaymentReviewSchema.parse(unwrapOne(await this.client.rpc("app_review_invoice_manual_payment_claim",{p_request_id:input.request_id,p_claim_id:id,p_decision:input.decision,p_paid_at:input.paid_at,p_reference:input.reference,p_reason:input.reason}),"Payment review"));
  }
  async listShareLinks(id:string) {
    return z.array(invoiceShareLinkSchema).max(100).parse(unwrapOne(await this.client.rpc("app_list_invoice_share_links",{p_invoice_id:id}),"Invoice links"));
  }
  async createShareLink(id:string,requestId:string,tokenHash:string) {
    return invoiceShareLinkSchema.parse(unwrapOne(await this.client.rpc("app_create_invoice_share_link",{p_invoice_id:id,p_request_id:requestId,p_token_sha256:tokenHash}),"Invoice link"));
  }
  async revokeShareLink(id:string) {
    return invoiceShareLinkSchema.parse(unwrapOne(await this.client.rpc("app_revoke_invoice_share_link",{p_link_id:id}),"Invoice link"));
  }
  constructor(private readonly client: UserMutationClient) {}

  async workEnabled(): Promise<boolean> {
    const result = await this.client.rpc("app_invoices_work_enabled");
    if (result.error) throw mapDatabaseError(result.error, "Invoice availability");
    return result.data === true;
  }

  private async listItems(invoiceId: string): Promise<InvoiceItemRow[]> {
    return unwrapMany(await this.client.rpc("app_list_invoice_items", { p_invoice_id: invoiceId })) as InvoiceItemRow[];
  }

  private async orderHistory(invoiceId: string) {
    const result = await this.client.rpc("app_get_invoice_order_history", { p_invoice_id: invoiceId });
    if (result.error) throw mapDatabaseError(result.error, "Invoice order history");
    return orderHistorySchema.parse(result.data);
  }

  async listOrderIds(invoiceId: string): Promise<string[]> {
    return (await this.orderHistory(invoiceId)).order_ids;
  }

  private async getFinancials(invoiceId: string): Promise<InvoiceFinancials> {
    const result = await this.client.rpc("app_get_invoice_financials", { p_invoice_id: invoiceId });
    if (result.error) throw mapDatabaseError(result.error, "Invoice financials");
    const financials = result.data?.[0];
    if (!financials) throw mapDatabaseError({ code: "PGRST116" }, "Invoice financials");
    return asFinancials(financials);
  }

  private async getManualClaimPaidAt(invoiceId: string, paymentId: string): Promise<string | null> {
    const { data } = await this.client.from("activity_events")
      .select("paid_at:metadata->>paid_at")
      .eq("entity_type", "invoice")
      .eq("entity_id", invoiceId)
      .eq("action", "invoice.manual_payment.approved")
      .filter("metadata->>payment_id", "eq", paymentId)
      .limit(1);
    const value = data?.[0]?.paid_at;
    return value && Number.isFinite(Date.parse(value)) ? value : null;
  }

  async list(): Promise<InvoiceSummary[]> {
    const [invoiceResult, companyResult, paymentResult] = await Promise.all([
      this.client.from("invoices").select().is("archived_at", null).order("created_at", { ascending: false }),
      this.client.from("companies").select().is("archived_at", null),
      this.client.from("invoice_payments").select().eq("status", "succeeded").order("settled_at", { ascending: false }),
    ]);
    const invoices = unwrapMany(invoiceResult) as InvoiceRow[];
    const companies = unwrapMany(companyResult) as CompanyRow[];
    const payments = unwrapMany(paymentResult) as InvoicePaymentRow[];
    const financials = await Promise.all(invoices.map((invoice) => this.getFinancials(invoice.id)));
    const companyNames = new Map(companies.map((company) => [company.id, company.name]));

    return invoices.map((invoice, index) => ({
      invoice,
      clientName: companyNames.get(invoice.company_id) ?? "Unknown client",
      financials: financials[index] as InvoiceFinancials,
      paidAt: latestSettledAt(payments, invoice.id),
    }));
  }

  /** invoice_items_order_unique guarantees at most one row per order. */
  async findItemByOrderId(orderId: string): Promise<InvoiceItemRow | null> {
    const result = await this.client.rpc("app_find_invoice_item_by_order_id", { p_order_id: orderId });
    if (result.error) throw mapDatabaseError(result.error, "Invoice item");
    return result.data?.id ? result.data as InvoiceItemRow : null;
  }

  async getById(id: string): Promise<InvoiceDetail> {
    const [invoiceResult, companyResult, itemResult, paymentResult, refundResult, activityResult, financials, sourceHistory] = await Promise.all([
      this.client.from("invoices").select().eq("id", id).is("archived_at", null).single(),
      this.client.from("companies").select().is("archived_at", null),
      this.listItems(id),
      this.client.from("invoice_payments").select().eq("invoice_id", id).order("created_at", { ascending: false }),
      this.client.from("invoice_refunds").select().eq("invoice_id", id).order("created_at", { ascending: false }),
      this.client.from("activity_events").select().eq("entity_type", "invoice").eq("entity_id", id).order("created_at", { ascending: false }),
      this.getFinancials(id),
      this.orderHistory(id),
    ]);
    const invoice = unwrapOne(invoiceResult, "Invoice") as InvoiceRow;
    const companies = unwrapMany(companyResult) as CompanyRow[];

    const payments = unwrapMany(paymentResult) as InvoicePaymentRow[];
    return {
      invoice,
      sourceHistory,
      clientName: companies.find((company) => company.id === invoice.company_id)?.name ?? "Unknown client",
      financials,
      items: itemResult,
      payments,
      refunds: unwrapMany(refundResult) as InvoiceRefundRow[],
      activity: unwrapMany(activityResult) as ActivityEventRow[],
    };
  }

  async listForClient(): Promise<ClientInvoiceSummary[]> {
    const invoiceResult = await this.client
      .from("invoices")
      .select()
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    const invoices = unwrapMany(invoiceResult) as InvoiceRow[];
    const financials = await Promise.all(
      invoices.map((invoice) => this.getFinancials(invoice.id)),
    );

    return invoices.map((invoice, index) => ({
      invoice,
      financials: financials[index] as InvoiceFinancials,
    }));
  }

  async listForCompany(companyId: string): Promise<CompanyInvoiceSummary[]> {
    const invoices = unwrapMany(await this.client
      .from("invoices")
      .select("*, invoice_payments!invoice_payments_invoice_id_fkey(id, processor, settled_at)")
      .eq("company_id", companyId)
      .is("archived_at", null)
      .eq("invoice_payments.status", "succeeded")
      .order("created_at", { ascending: false })
      .order("settled_at", { ascending: false, nullsFirst: false, referencedTable: "invoice_payments" })
      .limit(1, { referencedTable: "invoice_payments" }));
    return Promise.all(invoices.map(async ({ invoice_payments, ...invoice }) => {
      const payment = invoice.status === "paid" ? invoice_payments[0] : undefined;
      // A manual claim settles when reviewed, while its approval records the actual transfer date.
      const [financials, paidAt] = await Promise.all([
        this.getFinancials(invoice.id),
        payment?.processor === "manual_invoice_claim"
          ? this.getManualClaimPaidAt(invoice.id, payment.id)
          : Promise.resolve(payment?.settled_at ?? null),
      ]);
      return { invoice: invoice as InvoiceRow, financials, paidAt };
    }));
  }

  async getForClient(id: string): Promise<ClientInvoiceDetail> {
    const [invoiceResult, companyResult, itemResult, financials] = await Promise.all([
      this.client.from("invoices").select().eq("id", id).is("archived_at", null).single(),
      this.client.from("companies").select().is("archived_at", null),
      this.listItems(id),
      this.getFinancials(id),
    ]);
    const invoice = unwrapOne(invoiceResult, "Invoice") as InvoiceRow;
    const companies = unwrapMany(companyResult) as CompanyRow[];

    return {
      invoice,
      clientName: companies.find((company) => company.id === invoice.company_id)?.name ?? "Client",
      financials,
      items: itemResult,
    };
  }

  async create(input: CreateInvoiceInput): Promise<InvoiceRow> {
    const { request_id: requestId, ...payload } = input;
    return unwrapOne(
      await this.client.rpc("app_create_invoice", { p_request_id: requestId, p_payload: payload }),
      "Invoice",
    ) as InvoiceRow;
  }

  async update(id: string, patch: InvoicePayload | IssuedInvoiceUpdate): Promise<InvoiceRow> {
    return unwrapOne(
      await this.client.rpc("app_update_invoice", { p_invoice_id: id, p_patch: patch }),
      "Invoice",
    ) as InvoiceRow;
  }

  async issue(id: string): Promise<InvoiceRow> {
    return unwrapOne(await this.client.rpc("app_issue_invoice", { p_invoice_id: id }), "Invoice") as InvoiceRow;
  }

  async recordPayment(id: string, input: InvoicePaymentInput): Promise<InvoicePaymentRow> {
    return unwrapOne(
      await this.client.rpc("app_record_invoice_payment", {
        p_request_id: input.request_id,
        p_invoice_id: id,
        p_amount_cents: input.amount_cents,
        p_status: "succeeded",
        p_payment_method: input.payment_method,
      }),
      "Invoice payment",
    ) as InvoicePaymentRow;
  }

  async refund(id: string, input: InvoiceRefundInput): Promise<InvoiceRefundRow> {
    return unwrapOne(
      await this.client.rpc("app_refund_invoice", {
        p_request_id: input.request_id,
        p_invoice_id: id,
        p_amount_cents: input.amount_cents,
        p_reason: input.reason,
        p_status: "succeeded",
      }),
      "Invoice refund",
    ) as InvoiceRefundRow;
  }

  async void(id: string): Promise<InvoiceRow> {
    return unwrapOne(await this.client.rpc("app_void_invoice", { p_invoice_id: id }), "Invoice") as InvoiceRow;
  }
}
