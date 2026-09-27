"use client";

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import type { SubscriptionSummary } from "../../domain/subscriptions/schema";
import { formatCurrencyCents, formatDate } from "../../lib/format";
import { formatSubscriptionInterval, subscriptionStatusLabels } from "../../lib/subscriptions/presentation";
import { FilterOptionGroup, MobileFilterSheet } from "../ui/mobile-filter-sheet";
import { SubscriptionHealthBadge, SubscriptionStatusBadge } from "./subscription-status-badge";
import styles from "./subscriptions.module.css";

const tabs = ["active", "past_due", "paused", "pending_cancellation", "canceled", "all"] as const;
type Tab = (typeof tabs)[number];

export function subscriptionCounts(summaries: SubscriptionSummary[]) {
  return {
    active: summaries.filter((item) => item.status === "active").length,
    past_due: summaries.filter((item) => item.status === "past_due").length,
    paused: summaries.filter((item) => item.status === "paused").length,
    pending_cancellation: summaries.filter((item) => item.status === "pending_cancellation").length,
    canceled: summaries.filter((item) => item.status === "canceled").length,
    all: summaries.length,
  };
}

function tabLabel(tab: Tab) {
  return tab === "all" ? "All" : subscriptionStatusLabels[tab];
}

export function SubscriptionsList({
  summaries,
  canManage,
}: {
  summaries: SubscriptionSummary[];
  canManage: boolean;
}) {
  const [tab, setTab] = useState<Tab>("active");
  const [query, setQuery] = useState("");
  const [health, setHealth] = useState("all");
  const [interval, setInterval] = useState("all");
  const [draft, setDraft] = useState({ status: tab, health, interval });
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const counts = useMemo(() => subscriptionCounts(summaries), [summaries]);
  const visible = useMemo(() => summaries.filter((summary) => {
    if (tab !== "all" && summary.status !== tab) return false;
    if (health !== "all" && summary.health !== health) return false;
    if (interval !== "all" && summary.interval_unit !== interval) return false;
    if (!deferredQuery) return true;
    return `${summary.public_ref} ${summary.company_name} ${summary.service_name}`.toLocaleLowerCase().includes(deferredQuery);
  }), [deferredQuery, health, interval, summaries, tab]);

  const emptyMessage = deferredQuery
    ? "No subscriptions match your search."
    : tab === "all"
      ? "No subscriptions yet."
      : `No ${tabLabel(tab)} subscriptions.`;

  return (
    <div className={styles.listRoot}>
      <div className={styles.controlsRow}>
        <div className={styles.listTools}>
          <label className={styles.searchField}>
            <Search aria-hidden="true" />
            <span className="sr-only">Search subscriptions</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search reference, client, or Service"
              type="search"
            />
          </label>

          <MobileFilterSheet label="Filter subscriptions" alwaysVisible
            activeCount={Number(tab !== "active") + Number(health !== "all") + Number(interval !== "all")}
            onOpen={() => setDraft({ status: tab, health, interval })}
            onClear={() => { setTab("active"); setHealth("all"); setInterval("all"); }}
            onApply={() => { setTab(draft.status); setHealth(draft.health); setInterval(draft.interval); }}>
            <FilterOptionGroup label="Status" value={draft.status} onChange={(status) => setDraft({ ...draft, status: status as Tab })}
              options={tabs.map((value) => ({ value, label: tabLabel(value), count: counts[value] }))} />
            <FilterOptionGroup label="Health" value={draft.health} onChange={(health) => setDraft({ ...draft, health })}
              options={[{ value: "all", label: "All health states" }, { value: "requires_attention", label: "Requires attention" }, { value: "stalled", label: "Stalled" }]} />
            <FilterOptionGroup label="Interval" value={draft.interval} onChange={(interval) => setDraft({ ...draft, interval })}
              options={[{ value: "all", label: "All intervals" }, { value: "day", label: "Daily" }, { value: "week", label: "Weekly" }, { value: "month", label: "Monthly" }, { value: "year", label: "Yearly" }]} />
          </MobileFilterSheet>

          {canManage ? (
            <Link
              className={styles.createButton}
              href="/subscriptions/new"
            >
              <Plus aria-hidden="true" />
              <span>Subscription</span>
            </Link>
          ) : null}
        </div>
      </div>

      <p className={styles.resultCount} aria-live="polite">{visible.length} {visible.length === 1 ? "subscription" : "subscriptions"}</p>

      {visible.length === 0 ? <section className={styles.listEmpty}><h2>{emptyMessage}</h2><p>Try another status or clear the current filters.</p></section> : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className="sr-only">Subscriptions</caption>
              <thead><tr><th>Subscription</th><th>Client / Company</th><th>Service</th><th>Amount</th><th>Payments</th><th>Last payment</th><th>Next payment</th><th>Health</th><th>Status</th></tr></thead>
              <tbody>{visible.map((summary) => <tr key={summary.subscription_id}>
                <td><Link className={styles.rowLink} href={`/subscriptions/${summary.subscription_id}`} aria-label={`View Subscription ${summary.public_ref}`}><strong className={styles.subscriptionReference}>{summary.public_ref}</strong><small>{formatSubscriptionInterval(summary.interval_unit, summary.interval_count)}</small></Link></td>
                <td><strong>{summary.company_name}</strong></td>
                <td><span>{summary.service_name}</span></td>
                <td><strong>{formatCurrencyCents(summary.amount_cents, summary.currency)}</strong><small>{summary.currency}</small></td>
                <td><strong>{summary.paid_cycle_count}</strong></td>
                <td>{formatDate(summary.last_payment_at)}</td>
                <td>{summary.status === "canceled" ? "Ã¢â‚¬â€" : formatDate(summary.next_payment_on)}</td>
                <td><SubscriptionHealthBadge health={summary.health} status={summary.status} /></td>
                <td><SubscriptionStatusBadge status={summary.status} /></td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className={styles.mobileList}>{visible.map((summary) => <Link className={styles.mobileRow} href={`/subscriptions/${summary.subscription_id}`} key={summary.subscription_id}>
            <header><div><strong>{summary.service_name}</strong><span><span className={styles.subscriptionReference}>{summary.public_ref}</span>{" · "}{summary.company_name}</span></div><SubscriptionStatusBadge status={summary.status} /></header>
            <div className={styles.mobileMoney}><strong>{formatCurrencyCents(summary.amount_cents, summary.currency)}</strong><span>{formatSubscriptionInterval(summary.interval_unit, summary.interval_count)}</span></div>
            <dl><div><dt>Next payment</dt><dd>{summary.status === "canceled" ? "Ã¢â‚¬â€" : formatDate(summary.next_payment_on)}</dd></div><div><dt>Payments</dt><dd>{summary.paid_cycle_count}</dd></div></dl>
            {summary.health !== summary.status ? <SubscriptionHealthBadge health={summary.health} status={summary.status} /> : null}
          </Link>)}</div>
        </>
      )}
    </div>
  );
}
