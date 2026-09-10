import type { ReactNode } from "react";

/**
 * The intentional mobile representation of a department worklist — a
 * divider-separated list of records, not the desktop table squeezed into
 * horizontal scrolling, and not a stack of shadowed cards. Each row shows
 * three lines: identity + status, then work/target, then assignment +
 * resource — the same information the desktop table carries, reflowed for
 * a narrow viewport instead of hidden behind it.
 */
export function DepartmentWorkListMobile<Row extends { id: string }>({
  rows,
  onSelectRow,
  renderTitle,
  renderStatus,
  renderDetailLine,
  renderMetaLeft,
  renderMetaRight,
  renderAction,
  getRowLabel,
}: {
  rows: readonly Row[];
  onSelectRow: (row: Row) => void;
  renderTitle: (row: Row) => ReactNode;
  renderStatus: (row: Row) => ReactNode;
  renderDetailLine: (row: Row) => ReactNode;
  renderMetaLeft: (row: Row) => ReactNode;
  renderMetaRight: (row: Row) => ReactNode;
  /** Optional direct row action rendered beside, never inside, the inspector button. */
  renderAction?: (row: Row) => ReactNode;
  getRowLabel: (row: Row) => string;
}) {
  return (
    <ul className="dept-mobile-list">
      {rows.map((row) => (
        <li key={row.id}>
          <div className={renderAction ? "dept-mobile-row-shell" : undefined}>
            <button type="button" className="dept-mobile-row" onClick={() => onSelectRow(row)} aria-label={getRowLabel(row)}>
              <span className="dept-mobile-row-top">
                <span className="dept-mobile-row-title">{renderTitle(row)}</span>
                {renderStatus(row)}
              </span>
              <span className="dept-mobile-row-detail">{renderDetailLine(row)}</span>
              <span className="dept-mobile-row-top">
                <span className="dept-mobile-row-meta">{renderMetaLeft(row)}</span>
                <span className="dept-mobile-row-meta">{renderMetaRight(row)}</span>
              </span>
            </button>
            {renderAction ? <div className="dept-mobile-row-action">{renderAction(row)}</div> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
