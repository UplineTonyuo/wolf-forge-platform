"use server";

import { unstable_rethrow } from "next/navigation";
import { invoiceFundingVisibility, invoiceVisibility, invoiceWorkVisibility, walletVisibility, financialIdentity, storeVisibility } from "../../domain/invoices/visibility";
import { toClientSafeError } from "../../lib/errors/application-error";
import { getClientContext, getInternalContext } from "../../lib/supabase/next-server";

export async function loadFinancialVisibilityAction(scope: "internal" | "internal-work" | "client" | "client-detail" | "wallet" | "store" | "dashboard", invoiceId?: string, companyId?: string) {
  try {
    if (scope === "internal-work") {
      const context = await getInternalContext();
      const [enabled, detail] = await Promise.all([
        context.services.invoices.workEnabled(),
        invoiceId === undefined ? Promise.resolve(null) : context.services.invoices.get(invoiceId),
      ]);
      return { ok: true as const, signature: invoiceWorkVisibility(enabled, context.user.invoices, detail ? { id: detail.invoice.id, status: detail.invoice.status } : undefined, financialIdentity(context.user)) };
    }
    if (scope === "internal" || scope === "client") {
      const context = scope === "internal" ? await getInternalContext() : await getClientContext();
      if (scope === "internal" && companyId !== undefined) {
        const internal = context as Awaited<ReturnType<typeof getInternalContext>>;
        if (!internal.user.invoices.view && !internal.user.invoices.manage) return { ok: false as const, denied: true };
        const company = await internal.services.companies.get(companyId);
        const enabled = await internal.services.invoices.workEnabled();
        const rows = await internal.services.invoices.listForCompany(company.id);
        return { ok: true as const, signature: invoiceVisibility(rows, enabled, internal.user.invoices, JSON.stringify([financialIdentity(internal.user), company.id])) };
      }
      const [rows, enabled] = await Promise.all([
        scope === "internal" ? context.services.invoices.list() : context.services.invoices.listForClient(),
        context.services.invoices.workEnabled(),
      ]);
      return { ok: true as const, signature: invoiceVisibility(rows, enabled, scope === "internal" ? (context as Awaited<ReturnType<typeof getInternalContext>>).user.invoices : undefined, financialIdentity(context.user)) };
    }
    if (scope !== "wallet" && scope !== "store" && scope !== "dashboard" && scope !== "client-detail") return { ok: false as const, denied: true };
    const context = await getClientContext();
    const wallet = await context.services.wallets.getForCompany(context.user.companyId);
    if (scope === "dashboard" || scope === "client-detail") {
      const [rows, enabled, membership] = await Promise.all([context.services.invoices.listForClient(), context.services.invoices.workEnabled(), context.services.wfCard.getMembership(context.user.companyId)]);
      return { ok: true as const, signature: invoiceFundingVisibility(rows, enabled, wallet, membership?.status ?? null, financialIdentity(context.user)) };
    }
    if (scope === "wallet") {
      const [history, enabled, membership] = await Promise.all([context.services.wallets.listMyHistory(), context.services.invoices.workEnabled(), context.services.wfCard.getMembership(context.user.companyId)]);
      return { ok: true as const, signature: walletVisibility(wallet, history, enabled, membership?.status ?? null, financialIdentity(context.user)) };
    }
    await context.services.permissions.requireModuleAccess("portal_store");
    const [enabled, projects] = await Promise.all([
      context.services.invoices.workEnabled(), context.services.wfCard.storePurchaseProjectsEnabled(),
    ]);
    return { ok: true as const, signature: storeVisibility(wallet, enabled, projects, financialIdentity(context.user)) };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false as const, denied: ["PERMISSION_DENIED", "NOT_FOUND"].includes(toClientSafeError(error).code) };
  }
}
