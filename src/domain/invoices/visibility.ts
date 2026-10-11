import type { ClientInvoiceSummary } from "../../repositories/invoice-repository";
import type { InvoiceCapabilities } from "./schema";

export function invoiceVisibility(rows: ClientInvoiceSummary[], workEnabled: boolean, capabilities?: InvoiceCapabilities, identity?: string) {
  return JSON.stringify([workEnabled, capabilities, rows.map(({ invoice, financials }) => [
    invoice.id, invoice.updated_at, invoice.status, financials.presentation_state,
    financials.gross_paid_cents, financials.successful_refunds_cents, financials.balance_due_cents,
  ]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))), identity]);
}

export function invoiceWorkVisibility(workEnabled: boolean, capabilities: InvoiceCapabilities, target?: { id: string; status: string }, identity?: string) {
  return JSON.stringify([workEnabled, capabilities, target, identity]);
}

export function walletVisibility(wallet: { balance_cents: number; currency: string }, history: unknown[], workEnabled: boolean, membershipStatus: string | null, identity?: string) {
  return JSON.stringify([wallet.balance_cents, wallet.currency, history, workEnabled, membershipStatus, identity]);
}

export function invoiceFundingVisibility(rows: ClientInvoiceSummary[], workEnabled: boolean, wallet: { balance_cents: number; currency: string }, membershipStatus: string | null, identity?: string) {
  return JSON.stringify([invoiceVisibility(rows, workEnabled), wallet.balance_cents, wallet.currency, membershipStatus, identity]);
}

export type FinancialScope = "internal" | "internal-work" | "client" | "client-detail" | "wallet" | "store" | "dashboard";

export function financialIdentity(user: { id?: string; tenantId?: string; companyId?: string }) {
  return user.id ? JSON.stringify([user.id, user.tenantId, user.companyId]) : undefined;
}

export function storeVisibility(wallet: { balance_cents: number; currency: string }, enabled: boolean, projects: boolean, identity?: string) {
  return JSON.stringify([wallet.balance_cents, wallet.currency, enabled, projects, identity]);
}

// Money and added records refresh data without discarding an accepted mutation.
export function financialAuthority(scope: FinancialScope, signature: string): string {
  const value = JSON.parse(signature);
  switch (scope) {
    case "internal-work": return signature;
    case "internal": case "client": return JSON.stringify([value[0], value[1], value[3]]);
    case "wallet": return JSON.stringify([value[1], value[3], value[4], value[5]]);
    case "store": return JSON.stringify(value.slice(1));
    case "client-detail": case "dashboard": return JSON.stringify([JSON.parse(value[0])[0], value[2], value[3], value[4]]);
  }
}

export function financialRecordIds(scope: FinancialScope, signature: string): string[] {
  const value = JSON.parse(signature);
  if (scope === "client-detail" || scope === "dashboard") return JSON.parse(value[0])[2].map((row: unknown[]) => String(row[0]));
  if (scope === "internal" || scope === "client") return value[2].map((row: unknown[]) => String(row[0]));
  return [];
}
