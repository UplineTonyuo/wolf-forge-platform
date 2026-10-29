"use client";

import { ArrowDownLeft, ArrowUpRight, ReceiptText } from "lucide-react";
import { useState } from "react";
import type { CompanyWalletService } from "../../../services/company-wallet-service";
import { formatCurrencyCents, formatDateTime } from "../../../lib/format";
import { useBrowserTimeZone } from "../../../lib/use-browser-time-zone";
import styles from "./wallet-history.module.css";

type Transactions = Awaited<ReturnType<CompanyWalletService["listMyHistory"]>>;
export function WalletHistory({ transactions }: { transactions: Transactions }) {
  const [filter, setFilter] = useState("all");
  const timeZone = useBrowserTimeZone();
  const visible = transactions.filter((entry) => filter === "all" || (filter === "in" ? entry.amount_cents > 0 : entry.amount_cents < 0));
  return <section className="portal-page portal-section" aria-labelledby="wallet-history-heading">
    <header><h2 id="wallet-history-heading">Wallet history</h2><p className="portal-note">Your latest recorded transactions. Refund records do not automatically credit your balance.</p></header>
    <div className={styles.filters} role="group" aria-label="Filter wallet history">
      {[['all', 'All'], ['in', 'Money in'], ['out', 'Money out']].map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value!)}>{label}</button>)}
    </div>
    {visible.length ? <ol className={styles.list}>{visible.map((entry) => {
      const Icon = entry.amount_cents > 0 ? ArrowDownLeft : entry.amount_cents < 0 ? ArrowUpRight : ReceiptText;
      return <li key={entry.id}><details>
        <summary><Icon className={styles.icon} aria-hidden="true" /><span className={styles.description}><strong>{entry.source.replaceAll('_', ' ')}</strong><time dateTime={entry.created_at}>{formatDateTime(entry.created_at, timeZone)}</time></span><strong className={styles.amount}>{entry.amount_cents > 0 ? '+' : ''}{formatCurrencyCents(entry.amount_cents, entry.currency)}</strong></summary>
        <div className={styles.detail}>{entry.reason ? <p>{entry.reason}</p> : null}<p>Balance after transaction <strong>{formatCurrencyCents(entry.balance_after_cents, entry.currency)}</strong></p></div>
      </details></li>;
    })}</ol> : <p className="portal-empty">{transactions.length ? 'No transactions match this filter.' : 'No wallet transactions recorded.'}</p>}
  </section>;
}
