"use client";

import { LoaderCircle, MoreHorizontal, Printer, X } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  issueInvoiceAction,
  recordInvoicePaymentAction,
  refundInvoiceAction,
  voidInvoiceAction,
} from "../../app/actions/invoices";
import type { InvoiceCapabilities, InvoiceStatus } from "../../domain/invoices/schema";
import { centsToMoneyInput, parseMoneyToCents } from "../../lib/invoices/form-data";
import { formatCurrencyCents } from "../../lib/format";
import styles from "./invoice-admin.module.css";
import { AnimatedSelect } from "../ui/animated-select";
import { InvoiceEmailAction, InvoiceShareButton } from "./invoice-sharing";

type ModalKind = "issue" | "payment" | "refund" | "void";

export function InvoiceDetailActions({
  invoiceId,
  status,
  currency,
  totalCents,
  grossPaidCents,
  refundedCents,
  balanceDueCents,
  hasPendingPayment,
  capabilities,
  manualPending = false,
  invoiceLabel = "Invoice",
}: {
  invoiceId: string;
  status: InvoiceStatus;
  currency: string;
  totalCents: number;
  grossPaidCents: number;
  refundedCents: number;
  balanceDueCents: number;
  hasPendingPayment: boolean;
  capabilities: InvoiceCapabilities;
  manualPending?: boolean;
  invoiceLabel?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogTitleId = useId();
  const router = useRouter();
  const [modal, setModal] = useState<ModalKind>("issue");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("manual");
  const [requestId, setRequestId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const refundable = Math.max(grossPaidCents - refundedCents, 0);

  function open(kind: ModalKind) {
    setModal(kind);
    setError(null);
    setReason("");
    setRequestId(kind === "payment" || kind === "refund" ? crypto.randomUUID() : "");
    setAmount(kind === "refund" ? centsToMoneyInput(refundable) : "");
    dialogRef.current?.showModal();
  }

  function close() {
    if (!pending) dialogRef.current?.close();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (modal === "payment" || modal === "refund") {
      const submittedCents = parseMoneyToCents(amount);
      const availableCents = modal === "payment" ? balanceDueCents : refundable;
      const operation = modal === "payment" ? "Payment" : "Refund";

      if (submittedCents === null || submittedCents <= 0) {
        setError(`${operation} amount must be greater than zero.`);
        return;
      }
      if (submittedCents > availableCents) {
        setError(`${operation} cannot exceed ${formatCurrencyCents(availableCents, currency)}.`);
        return;
      }
    }
    startTransition(async () => {
      const result = modal === "issue"
        ? await issueInvoiceAction(invoiceId)
        : modal === "payment"
          ? await recordInvoicePaymentAction(invoiceId, amount, method, requestId)
          : modal === "refund"
            ? await refundInvoiceAction(invoiceId, amount, reason, requestId)
            : await voidInvoiceAction(invoiceId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      dialogRef.current?.close();
      router.refresh();
    });
  }

  const canIssue = status === "draft" && capabilities.manage;
  const canPay = ["unpaid", "payment_pending"].includes(status) && balanceDueCents > 0 && capabilities.markPaid && !manualPending;
  const canRefund = status === "paid" && refundable > 0 && capabilities.refund;
  const canVoid = ["unpaid", "payment_pending"].includes(status) && grossPaidCents === 0 && !hasPendingPayment && !manualPending && capabilities.void;
  const primary = canIssue ? <button className="button-primary" type="button" onClick={() => open("issue")}>Issue Invoice</button>
    : canPay ? <button className="button-primary" type="button" onClick={() => open("payment")}>Record Payment</button>
      : canRefund ? <button className="button-primary" type="button" onClick={() => open("refund")}>Refund</button> : null;
  const canEdit = capabilities.manage && ["draft", "unpaid", "payment_pending"].includes(status);

  return (
    <>
      <div className={styles.detailActions}>
        {primary}
        {capabilities.manage && status !== "draft" ? <InvoiceShareButton invoiceId={invoiceId} canCreate={status !== "void"} /> : null}
        <details><summary className="button-secondary" aria-label="Invoice actions"><MoreHorizontal aria-hidden="true" /></summary><div>{canEdit ? <Link href={`/invoices/${invoiceId}/edit`}>Edit</Link> : null}{capabilities.manage && status !== "draft" ? <InvoiceEmailAction invoiceId={invoiceId} invoiceLabel={invoiceLabel} /> : null}<button type="button" onClick={() => window.print()}><Printer size={15} aria-hidden="true" />Print or save as PDF</button>{canVoid ? <button type="button" onClick={() => open("void")}>Void invoice</button> : null}</div></details>
      </div>
      <dialog className={styles.dialog} ref={dialogRef} aria-labelledby={dialogTitleId} onCancel={(event) => { if (pending) event.preventDefault(); }}>
        <form onSubmit={submit}>
          <header><div><h2 id={dialogTitleId}>{modal === "issue" ? "Issue invoice?" : modal === "payment" ? "Record Payment" : modal === "refund" ? "Record Refund" : "Void invoice?"}</h2>{modal === "issue" ? <p>The invoice will receive its invoice number and become payable.</p> : modal === "void" ? <p>This invoice will no longer accept payments. Financial history will be preserved.</p> : modal === "refund" ? <p>This records a refund in the ledger. It does not return money to a wallet or payment provider.</p> : null}</div><button type="button" aria-label="Close" onClick={close}><X aria-hidden="true" /></button></header>
          {modal === "payment" ? <><dl className={styles.dialogSummary}><div><dt>Invoice total</dt><dd>{formatCurrencyCents(totalCents, currency)}</dd></div><div><dt>Already paid</dt><dd>{formatCurrencyCents(grossPaidCents, currency)}</dd></div><div><dt>Remaining balance</dt><dd>{formatCurrencyCents(balanceDueCents, currency)}</dd></div></dl><label className={styles.field}><span>Amount</span><input autoFocus inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label><label className={styles.field}><span>Payment method</span><AnimatedSelect name="payment_method" label="Payment method" menuLabel="Payment methods" value={method} onChange={setMethod} options={[{value:"manual",label:"Manual"},{value:"bank_transfer",label:"Bank transfer"},{value:"wallet",label:"Wallet"},{value:"other",label:"Other"}]} /></label></> : null}
          {modal === "refund" ? <><dl className={styles.dialogSummary}><div><dt>Paid</dt><dd>{formatCurrencyCents(grossPaidCents, currency)}</dd></div><div><dt>Already refunded</dt><dd>{formatCurrencyCents(refundedCents, currency)}</dd></div><div><dt>Refundable</dt><dd>{formatCurrencyCents(refundable, currency)}</dd></div></dl><label className={styles.field}><span>Amount</span><input autoFocus inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label className={styles.field}><span>Reason</span><textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label></> : null}
          {error ? <p className={styles.formError} role="alert">{error}</p> : null}
          <footer><button className="button-secondary" type="button" disabled={pending} onClick={close}>Cancel</button><button className="button-primary" type="submit" aria-busy={pending || undefined} disabled={pending || (modal === "payment" && !amount.trim()) || (modal === "refund" && (!amount.trim() || !reason.trim()))}>{pending ? <><LoaderCircle className="spinner" aria-hidden="true" />Saving…</> : modal === "issue" ? "Issue Invoice" : modal === "payment" ? "Record Payment" : modal === "refund" ? "Refund" : "Void Invoice"}</button></footer>
        </form>
      </dialog>
    </>
  );
}
