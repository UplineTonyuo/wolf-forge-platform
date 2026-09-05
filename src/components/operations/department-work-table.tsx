import type { KeyboardEvent, ReactNode } from "react";

export type DepartmentWorkColumn<Row> = {
  key: string;
  header: string;
  /** Governs column proportions — a `<col>` width, e.g. "26%" or "120px". */
  width?: string;
  render: (row: Row) => ReactNode;
  /** Native tooltip text for a truncated cell, when the rendered content alone doesn't carry the full value. */
  title?: (row: Row) => string | undefined;
  /** Right/center alignment for columns where left isn't the natural read, e.g. a short status or link column. Defaults to left. */
  align?: "left" | "center";
  /** Drops out at the tablet breakpoint, before the layout gets cramped — the lowest-priority column for this department, not a fixed position. */
  hideOnTablet?: boolean;
};

/**
 * The shared desktop worklist — one row per record, whole-row activation,
 * a persistent selected-row state, and column widths driven by data
 * priority rather than equal division. Semantics stay a real `<table>`
 * throughout: assistive tech gets `row`/`cell` structure for free, and
 * screen-reader/keyboard users reach the same single activation path
 * sighted mouse users do (the row itself), rather than a smaller nested
 * hit target.
 */
function cellClassName<Row>(column: DepartmentWorkColumn<Row>): string | undefined {
  const classes = [
    column.align === "center" ? "dept-align-center" : null,
    column.hideOnTablet ? "dept-col-hide-tablet" : null,
  ].filter((value): value is string => value !== null);
  return classes.length > 0 ? classes.join(" ") : undefined;
}

export function DepartmentWorkTable<Row extends { id: string }>({
  columns,
  rows,
  selectedRowId,
  onSelectRow,
  getRowLabel,
}: {
  columns: readonly DepartmentWorkColumn<Row>[];
  rows: readonly Row[];
  selectedRowId: string | null;
  onSelectRow: (row: Row) => void;
  /** Accessible name for the row, e.g. "Open seeitgonejunkremoval.com". */
  getRowLabel: (row: Row) => string;
}) {
  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, row: Row) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectRow(row);
  }

  return (
    <div className="dept-table-wrap">
      <table className="dept-table">
        <colgroup>
          {columns.map((column) => (
            <col
              key={column.key}
              style={column.width ? { width: column.width } : undefined}
              className={column.hideOnTablet ? "dept-col-hide-tablet" : undefined}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cellClassName(column)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              tabIndex={0}
              aria-label={getRowLabel(row)}
              aria-current={selectedRowId === row.id ? "true" : undefined}
              className={selectedRowId === row.id ? "dept-row dept-row-selected" : "dept-row"}
              onClick={() => onSelectRow(row)}
              onKeyDown={(event) => handleRowKeyDown(event, row)}
            >
              {columns.map((column) => (
                <td key={column.key} className={cellClassName(column)} title={column.title?.(row)}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
