"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import styles from "../projects/projects-workspace.module.css";

const pageSize = 10;

export function useTicketPagination(total: number, selectedIndex = 0) {
  const [page, setPage] = useState(() => Math.floor(Math.max(0, selectedIndex) / pageSize) + 1);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const start = (current - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  return { total, pages, current, start, end, setPage };
}

export function TicketPagination({
  total, pages, current, start, end, setPage,
}: ReturnType<typeof useTicketPagination>) {
  const numbers = Array.from({ length: pages }, (_, i) => i + 1).filter(
    (n) => pages <= 5 || n === 1 || n === pages || Math.abs(n - current) <= 1,
  );

  return (
    <div className={styles.tableFooter}>
      <span aria-live="polite">
        {pages > 1 ? `${start + 1}–${end} of ${total} tickets` : `${total} ${total === 1 ? "ticket" : "tickets"}`}
      </span>
      {pages > 1 && (
        <nav aria-label="Ticket pages" className={styles.pagination}>
          <button type="button" aria-label="Previous page" disabled={current === 1} onClick={() => setPage(current - 1)}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          {numbers.map((n, i) => (
            <Fragment key={n}>
              {n - (numbers[i - 1] ?? n) > 1 && <span aria-hidden="true">…</span>}
              <button type="button" aria-label={`Page ${n}`} aria-current={current === n ? "page" : undefined} onClick={() => setPage(n)}>
                {n}
              </button>
            </Fragment>
          ))}
          <button type="button" aria-label="Next page" disabled={current === pages} onClick={() => setPage(current + 1)}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
}
