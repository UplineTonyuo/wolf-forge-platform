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

export type InvoiceSummary = {
  invoice: InvoiceRow;
  clientName: string;
  financials: InvoiceFinancials;
  paidAt: string | null;
};

export type InvoiceDetail = {
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
  constructor(private readonly client: UserMutationClient) {}

  private async getFinancials(invoiceId: string): Promise<InvoiceFinancials> {
    const result = await this.client.rpc("app_get_invoice_financials", { p_invoice_id: invoiceId });
    if (result.error) throw mapDatabaseError(result.error, "Invoice financials");
    const financials = result.data?.[0];
    if (!financials) throw mapDatabaseError({ code: "PGRST116" }, "Invoice financials");
    return asFinancials(financials);
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

  async getById(id: string): Promise<InvoiceDetail> {
    const [invoiceResult, companyResult, itemResult, paymentResult, refundResult, activityResult, financials] = await Promise.all([
      this.client.from("invoices").select().eq("id", id).is("archived_at", null).single(),
      this.client.from("companies").select().is("archived_at", null),
      this.client.from("invoice_items").select().eq("invoice_id", id).order("position"),
      this.client.from("invoice_payments").select().eq("invoice_id", id).order("created_at", { ascending: false }),
      this.client.from("invoice_refunds").select().eq("invoice_id", id).order("created_at", { ascending: false }),
      this.client.from("activity_events").select().eq("entity_type", "invoice").eq("entity_id", id).order("created_at", { ascending: false }),
      this.getFinancials(id),
    ]);
    const invoice = unwrapOne(invoiceResult, "Invoice") as InvoiceRow;
    const companies = unwrapMany(companyResult) as CompanyRow[];

    return {
      invoice,
      clientName: companies.find((company) => company.id === invoice.company_id)?.name ?? "Unknown client",
      financials,
      items: unwrapMany(itemResult) as InvoiceItemRow[],
      payments: unwrapMany(paymentResult) as InvoicePaymentRow[],
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

  async getForClient(id: string): Promise<ClientInvoiceDetail> {
    const [invoiceResult, companyResult, itemResult, financials] = await Promise.all([
      this.client.from("invoices").select().eq("id", id).is("archived_at", null).single(),
      this.client.from("companies").select().is("archived_at", null),
      this.client.from("invoice_items").select().eq("invoice_id", id).order("position"),
      this.getFinancials(id),
    ]);
    const invoice = unwrapOne(invoiceResult, "Invoice") as InvoiceRow;
    const companies = unwrapMany(companyResult) as CompanyRow[];

    return {
      invoice,
      clientName: companies.find((company) => company.id === invoice.company_id)?.name ?? "Client",
      financials,
      items: unwrapMany(itemResult) as InvoiceItemRow[],
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
