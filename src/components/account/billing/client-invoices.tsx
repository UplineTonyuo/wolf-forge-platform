import { ArrowRight, ReceiptText } from "lucide-react";
import Link from "next/link";
import { invoiceAttention } from "../../../domain/client-portal/attention";
import {
  composeClientBalance,
  describeCurrencyBalance,
  invoiceIsCollectible,
} from "../../../domain/client-portal/balance";
import type { ClientInvoiceSummary } from "../../../repositories/invoice-repository";
import { formatCurrencyCents, formatDate } from "../../../lib/format";
import { AttentionPill } from "../ui/attention-pill";

/**
 * Client Invoices.
 *
 * Rows come from invoices_client_select_own_company, which scopes to the
 * caller's own company at the database. The status shown is the derived
 * presentation state from app_get_invoice_financials — overdue, partially
 * refunded and void are real states there, not labels invented here.
 */

function invoiceLabel(value: number | null): string {
  return value == null ? "Invoice draft" : `Invoice #WF-${String(value).padStart(4, "0")}`;
}

export function ClientInvoicesView({ invoices, workEnabled = true }: { invoices: ClientInvoiceSummary[]; workEnabled?: boolean }) {
  const balance = composeClientBalance(invoices);

  const outstanding = invoices.filter((entry) => invoiceIsCollectible(entry.financials));
  const settled = invoices.filter((entry) => !invoiceIsCollectible(entry.financials));

  function Row({ entry }: { entry: ClientInvoiceSummary }) {
    const { invoice, financials } = entry;
    const attention = invoiceAttention(financials.presentation_state);

    return (
      <li key={invoice.id}>
        <Link href={`/account/invoices/${invoice.id}`} className="portal-invoice-row">
          {/*
           * Icon and title share one line; the issued/due line sits directly
           * under the title rather than under the icon, so the left column
           * reads as one grouped block.
           */}
          <span className="portal-invoice-main">
            <span className="portal-invoice-title">
              <ReceiptText aria-hidden={true} />
              <strong>{invoiceLabel(invoice.invoice_number)}</strong>
            </span>
            <span className="portal-invoice-sub">
              Issued {formatDate(invoice.created_at)}
              {invoice.due_at ? ` · Due ${formatDate(invoice.due_at)}` : " · No due date"}
            </span>
          </span>

          <AttentionPill tone={attention.tone} label={attention.label} />

          <span className="portal-invoice-amounts">
            <strong>{formatCurrencyCents(invoice.total_cents, invoice.currency)}</strong>
            {/*
             * Balance remaining is only meaningful while money is outstanding.
             * A settled invoice shows its total alone rather than a
             * "£0.00 remaining" line that says nothing.
             */}
            <span>
              {financials.balance_due_cents > 0
                ? `${formatCurrencyCents(financials.balance_due_cents, invoice.currency)} remaining`
                : "Nothing outstanding"}
            </span>
          </span>

          <ArrowRight aria-hidden={true} />
        </Link>
      </li>
    );
  }

  return (
    <div className="portal-page">
      <header className="portal-page-head">
        <h1>Invoices</h1>
        <p>{workEnabled ? "Everything Wolf Forge has billed your account, and what remains outstanding." : "Invoices is disabled. Your authorized issued financial history remains available as read-only."}</p>
      </header>

      <section className="portal-balance" aria-labelledby="portal-balance-heading">
        <h2 id="portal-balance-heading" className="portal-billing-label">
          Outstanding balance
        </h2>

        {balance.currencies.length === 0 ? (
          <>
            <strong className="portal-balance-figure">{formatCurrencyCents(0, "USD")}</strong>
            <span className="portal-billing-note">You&rsquo;re all caught up.</span>
          </>
        ) : (
          <div className="portal-balance-currencies">
            {/*
             * One figure per currency, never a sum. Wolf Forge has no FX rate
             * source, so converting or adding across currencies would be a
             * fabricated number.
             */}
            {balance.currencies.map((entry) => (
              <div key={entry.currency} className="portal-balance-currency">
                <strong className="portal-balance-figure">
                  {formatCurrencyCents(entry.outstandingCents, entry.currency)}
                </strong>
                {balance.isMultiCurrency ? (
                  <em className="portal-billing-currency-code">{entry.currency}</em>
                ) : null}
                <span className="portal-billing-note">{describeCurrencyBalance(entry)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {invoices.length === 0 ? (
        <p className="portal-empty">
          No invoices yet. When Wolf Forge bills your account, every invoice appears here with its
          status and balance.
        </p>
      ) : (
        <>
          {outstanding.length > 0 ? (
            <section className="portal-section" aria-labelledby="portal-invoices-open">
              <header className="portal-section-head">
                <h2 id="portal-invoices-open">Awaiting payment</h2>
              </header>
              <ul className="portal-invoice-list">
                {outstanding.map((entry) => (
                  <Row key={entry.invoice.id} entry={entry} />
                ))}
              </ul>
            </section>
          ) : null}

          {settled.length > 0 ? (
            <section className="portal-section" aria-labelledby="portal-invoices-settled">
              <header className="portal-section-head">
                <h2 id="portal-invoices-settled">History</h2>
              </header>
              <ul className="portal-invoice-list">
                {settled.map((entry) => (
                  <Row key={entry.invoice.id} entry={entry} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
