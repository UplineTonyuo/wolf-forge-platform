"use client";

import { RotateCcw, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { updateInvestmentIntentStatusAction } from "../../app/actions/store-interest";
import {
  filterInvestmentIntents,
  intentCadenceLabels,
  investmentIntentCounts,
  investmentIntentStatusCounts,
  type InvestmentIntentView,
} from "../../domain/store-interest/projections";
import {
  investmentIntentStatusLabels,
  investmentIntentStatuses,
  type InvestmentIntentStatus,
} from "../../domain/store-interest/schema";
import { formatDate, formatDateTime } from "../../lib/format";
import { InvestmentIntentActions } from "./investment-intent-actions";
import { AnimatedSelect } from "../ui/animated-select";
import { EmptyState } from "../ui/list-states";
import {
  FilterOptionGroup,
  MobileFilterSheet,
} from "../ui/mobile-filter-sheet";
import adminList from "../ui/admin-list.module.css";
import styles from "./investment-intent.module.css";

/**
 * The Investment Intent workspace.
 *
 * Built on the shared admin list system rather than a new table, so it reads as
 * a sibling of Coupons and Invoices instead of a separately-built CRUD screen.
 * Filtering happens here in the browser over the payload the server already
 * sent -- the same idiom the Tickets list and the Store catalogue use -- so
 * switching a filter is instant.
 *
 * One thing this page deliberately does NOT do is add money up. One-time,
 * monthly and annual prices have no honest common total; the cart refuses to
 * print one for the client and there is no better reason to print one here.
 * Counts answer the question the page exists for.
 */

type StatusFilter = InvestmentIntentStatus | "all";

const statusFilters: StatusFilter[] = ["all", ...investmentIntentStatuses];

const statusFilterLabels: Record<StatusFilter, string> = {
  all: "All",
  ...investmentIntentStatusLabels,
};

const statusOptions = investmentIntentStatuses.map((status) => ({
  value: status,
  label: investmentIntentStatusLabels[status],
}));

/** Cart state is the latest recorded activity, never a live mirror. Said once, quietly. */
const cartStateHint = "Cart state reflects the latest recorded client activity.";

function CartChip({ view }: { view: InvestmentIntentView }) {
  return (
    <span
      className={styles.cartChip}
      data-in-cart={view.inCart}
      title={cartStateHint}
    >
      {view.inCart ? "In cart" : "Removed"}
    </span>
  );
}

function StatusControl({
  view,
  canManage,
  onChanged,
}: {
  view: InvestmentIntentView;
  canManage: boolean;
  onChanged: (status: InvestmentIntentStatus) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) {
    return (
      <span className={styles.statusBadge} data-status={view.status}>
        {investmentIntentStatusLabels[view.status]}
      </span>
    );
  }

  return (
    <div className={styles.statusControl}>
      <AnimatedSelect
        name={`intent-status-${view.id}`}
        label="Status"
        menuLabel={`Status for ${view.companyName} and ${view.serviceName}`}
        options={statusOptions}
        value={view.status}
        disabled={pending}
        onChange={(next) => {
          if (next === view.status) return;

          const status = next as InvestmentIntentStatus;
          setPending(true);
          setError(null);

          void updateInvestmentIntentStatusAction({ intentId: view.id, status })
            .then((result) => {
              if (result.ok) onChanged(status);
              else setError(result.error);
            })
            .catch(() => setError("The status could not be updated."))
            .finally(() => setPending(false));
        }}
      />
      {error ? (
        <span className={styles.statusError} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function InvestmentIntentWorkspace({
  intents,
  canManage = false,
  focusIntentId = null,
}: {
  intents: InvestmentIntentView[];
  canManage?: boolean;
  /** From a notification link, so the row it refers to is findable on arrival. */
  focusIntentId?: string | null;
}) {
  /*
   * A status change is applied locally as well as revalidated on the server, so
   * the row settles immediately instead of waiting for a round trip to redraw.
   */
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, InvestmentIntentStatus>
  >({});
  /*
   * The same shape, for the same reason: creating a conversation is revalidated
   * on the server, and the override only keeps the row's own menu from offering
   * "Create" again during the round trip. It is never the source of truth --
   * the row's authoritative active ticket id replaces it on the next render.
   */
  const [conversationOverrides, setConversationOverrides] = useState<
    Record<string, string>
  >({});
  const [status, setStatus] = useState<StatusFilter>("all");
  const [inCartOnly, setInCartOnly] = useState(false);
  const [query, setQuery] = useState("");

  /*
   * The mobile Filter sheet edits a draft and commits it on Apply, the same
   * contract the Clients filter panel uses. Draft and applied state are seeded
   * from each other at the two points that matter: on open, and on commit.
   */
  const [draftStatus, setDraftStatus] = useState<StatusFilter>("all");
  const [draftInCartOnly, setDraftInCartOnly] = useState(false);

  const resolved = useMemo(
    () =>
      intents.map((intent) => {
        const status = statusOverrides[intent.id];
        const activeTicketId = conversationOverrides[intent.id];
        if (!status && !activeTicketId) return intent;
        return {
          ...intent,
          status: status ?? intent.status,
          activeTicketId: activeTicketId ?? intent.activeTicketId,
        };
      }),
    [conversationOverrides, intents, statusOverrides],
  );

  const counts = useMemo(() => investmentIntentCounts(resolved), [resolved]);
  const statusCounts = useMemo(() => investmentIntentStatusCounts(resolved), [resolved]);

  const visible = useMemo(
    () => filterInvestmentIntents(resolved, { status, inCartOnly, query }),
    [inCartOnly, query, resolved, status],
  );

  function countFor(filter: StatusFilter): number {
    return filter === "all" ? counts.total : statusCounts[filter];
  }

  const activeFilterCount =
    (status === "all" ? 0 : 1) + (inCartOnly ? 1 : 0);

  return (
    <>
      {/*
        * Counts only, and each one is a question William actually asks:
        * who is interested, who is holding something right now, who has not
        * been contacted yet, and who came back for a second look.
        */}
      <dl className={styles.summary}>
        <div>
          <dt>Interests</dt>
          <dd>{counts.total}</dd>
        </div>
        <div>
          <dt>In cart now</dt>
          <dd>{counts.inCart}</dd>
        </div>
        <div>
          <dt>Awaiting review</dt>
          <dd>{counts.new}</dd>
        </div>
        <div>
          <dt>Renewed</dt>
          <dd>{counts.renewed}</dd>
        </div>
      </dl>

      <div className={adminList.toolbar}>
        {/*
          * Desktop only. At mobile widths this whole group moves into the
          * Filter sheet below -- same statuses, same counts, same state.
          */}
        <div
          className={`${adminList.filters} ${styles.statusFilters}`}
          role="group"
          aria-label="Investment intent filters"
        >
          {statusFilters.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`${adminList.filter} ${status === filter ? adminList.filterActive : ""}`}
              aria-pressed={status === filter}
              onClick={() => setStatus(filter)}
            >
              {statusFilterLabels[filter]}
              <span className={styles.filterCount}>{countFor(filter)}</span>
            </button>
          ))}

          <button
            type="button"
            className={`${adminList.filter} ${inCartOnly ? adminList.filterActive : ""}`}
            aria-pressed={inCartOnly}
            title={cartStateHint}
            onClick={() => setInCartOnly((current) => !current)}
          >
            In cart
            <span className={styles.filterCount}>{counts.inCart}</span>
          </button>
        </div>

        <div className={adminList.trailing}>
          <label className={styles.search}>
            <Search aria-hidden={true} />
            <span>Search investment intent</span>
            <input
              type="search"
              value={query}
              placeholder="Search client or investment"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <X aria-hidden={true} />
              </button>
            ) : null}
          </label>

          <MobileFilterSheet
            label="Filter investment intent"
            activeCount={activeFilterCount}
            onOpen={() => {
              setDraftStatus(status);
              setDraftInCartOnly(inCartOnly);
            }}
            onClear={() => {
              setStatus("all");
              setInCartOnly(false);
              setDraftStatus("all");
              setDraftInCartOnly(false);
            }}
            onApply={() => {
              setStatus(draftStatus);
              setInCartOnly(draftInCartOnly);
            }}
          >
            <FilterOptionGroup
              label="Status"
              value={draftStatus}
              onChange={(next) => setDraftStatus(next as StatusFilter)}
              options={[
                { value: "all", label: "All", count: counts.total },
                ...investmentIntentStatuses.map((entry) => ({
                  value: entry,
                  label: investmentIntentStatusLabels[entry],
                  count: statusCounts[entry],
                })),
              ]}
            />

            {/*
              * Cart state is a separate axis, not a seventh status, so it stays
              * a separate group rather than being folded into the six above.
              */}
            <FilterOptionGroup
              label="Cart"
              value={draftInCartOnly ? "in_cart" : "any"}
              onChange={(next) => setDraftInCartOnly(next === "in_cart")}
              options={[
                { value: "any", label: "Any cart state" },
                { value: "in_cart", label: "In cart", count: counts.inCart },
              ]}
            />
          </MobileFilterSheet>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={intents.length === 0 ? "No investment interest yet" : "No matching interest"}
          body={
            intents.length === 0
              ? "When a client adds an investment to their Store cart, it appears here so you can reach out."
              : "Nothing matches the current filters."
          }
        />
      ) : (
        <>
          <div className={`desktop-table-wrap ${styles.tableWrap}`}>
            <table className={`${styles.table} ${adminList.table}`}>
              <colgroup>
                <col className={styles.clientColumn} />
                <col className={styles.investmentColumn} />
                <col />
                <col />
                <col />
                <col />
                <col className={styles.statusColumn} />
                <col className={styles.actionsColumn} />
              </colgroup>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Investment</th>
                  <th>Price</th>
                  <th>Cart</th>
                  <th>First added</th>
                  <th>Latest activity</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((view) => (
                  <tr key={view.id} data-focused={view.id === focusIntentId || undefined}>
                    <td>
                      <strong className={styles.company}>{view.companyName}</strong>
                      {view.contactedByName ? (
                        <span className={styles.contactedBy}>
                          Contacted by {view.contactedByName}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span className={styles.investment}>{view.serviceName}</span>
                      {view.categoryName ? (
                        <span className={styles.category}>{view.categoryName}</span>
                      ) : null}
                    </td>
                    <td>
                      <span className={styles.price}>{view.priceLabel}</span>
                      <span className={styles.cadence}>{intentCadenceLabels[view.cadence]}</span>
                    </td>
                    <td>
                      <CartChip view={view} />
                      {view.renewed ? (
                        <span
                          className={styles.renewed}
                          title={`Removed and added back ${view.addCount - 1} ${
                            view.addCount - 1 === 1 ? "time" : "times"
                          }.`}
                        >
                          <RotateCcw aria-hidden={true} />
                          Renewed
                        </span>
                      ) : null}
                    </td>
                    <td>{formatDate(view.firstAddedAt)}</td>
                    <td>{formatDateTime(view.lastActivityAt)}</td>
                    <td>
                      <StatusControl
                        view={view}
                        canManage={canManage}
                        onChanged={(next) =>
                          setStatusOverrides((current) => ({ ...current, [view.id]: next }))
                        }
                      />
                    </td>
                    <td>
                      <InvestmentIntentActions
                        view={view}
                        onConversationCreated={(intentId, ticketId) =>
                          setConversationOverrides((current) => ({
                            ...current,
                            [intentId]: ticketId,
                          }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={`mobile-record-list ${styles.mobileList}`}>
            {visible.map((view) => (
              <article
                className={styles.mobileCard}
                key={view.id}
                data-focused={view.id === focusIntentId || undefined}
              >
                <div className={styles.mobileCardHeading}>
                  <div>
                    <strong>{view.companyName}</strong>
                    <span>{view.serviceName}</span>
                  </div>
                  <CartChip view={view} />
                </div>

                <dl>
                  <div>
                    <dt>Price</dt>
                    <dd>
                      {view.priceLabel} · {intentCadenceLabels[view.cadence]}
                    </dd>
                  </div>
                  <div>
                    <dt>First added</dt>
                    <dd>{formatDate(view.firstAddedAt)}</dd>
                  </div>
                  <div>
                    <dt>Latest activity</dt>
                    <dd>{formatDateTime(view.lastActivityAt)}</dd>
                  </div>
                  {view.renewed ? (
                    <div>
                      <dt>Renewed</dt>
                      <dd>{view.addCount - 1}×</dd>
                    </div>
                  ) : null}
                </dl>

                <div className={styles.mobileActions}>
                  <StatusControl
                    view={view}
                    canManage={canManage}
                    onChanged={(next) =>
                      setStatusOverrides((current) => ({ ...current, [view.id]: next }))
                    }
                  />
                  <InvestmentIntentActions
                    view={view}
                    onConversationCreated={(intentId, ticketId) =>
                      setConversationOverrides((current) => ({
                        ...current,
                        [intentId]: ticketId,
                      }))
                    }
                  />
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}
