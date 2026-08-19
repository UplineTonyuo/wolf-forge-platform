import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./admin-list.module.css";

export type ListToolbarFilter = {
  /** Stable key; also what the caller compares against to decide `active`. */
  value: string;
  label: string;
  href: string;
  active: boolean;
};

/**
 * The filter row shared by the Coupons and Invoices list pages.
 *
 * It renders navigation only — every filter is a plain link to the same route
 * with a different query string, so filtering stays server-resolved and this
 * component holds no state.
 */
export function ListToolbar({
  label,
  filters,
  action,
  search,
}: {
  /** Accessible name for the filter group, e.g. "Invoice status filters". */
  label: string;
  filters: ListToolbarFilter[];
  /**
   * Optional primary action for the list, e.g. Add Coupon. Rendered beside the
   * search control on the trailing edge; omit it and the row simply closes up.
   */
  action?: ReactNode;
  /** Optional search control, rendered to the right on wide layouts. */
  search?: ReactNode;
}) {
  return (
    <div className={styles.toolbar}>
      <nav className={styles.filters} aria-label={label}>
        {filters.map((filter) => (
          <Link
            key={filter.value}
            href={filter.href}
            className={
              filter.active
                ? `${styles.filter} ${styles.filterActive}`
                : styles.filter
            }
            aria-current={filter.active ? "page" : undefined}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      {/*
        The trailing group keeps the action and the search on one baseline so
        they read as a pair rather than as two unrelated controls, and it moves
        to the next row as a unit when the filters run out of width.
      */}
      {action || search ? (
        <div className={styles.trailing}>
          {action ? <div className={styles.action}>{action}</div> : null}
          {search ? <div className={styles.search}>{search}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
