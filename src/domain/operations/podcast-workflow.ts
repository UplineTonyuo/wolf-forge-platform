/**
 * Podcast SEO department workflow — pure read model + normalization.
 *
 * This module never performs I/O. It turns whatever `string[][]` a Google
 * Sheets `values.get` call (or a test fixture standing in for one) returns
 * into `PodcastOperationItem[]`. Keeping normalization here — outside both
 * the fetch adapter and the React components — is what lets the parser be
 * unit-tested against representative sheet fixtures without any live
 * connection, and lets the UI stay a thin renderer of already-canonical data.
 *
 * Deliberately separate from `domain/team` — this is external operational
 * data, never mirrored into `team_tasks`.
 */

export type PodcastOperationStatus = "in_progress" | "stuck" | "completed" | "cancelled";

export const podcastOperationStatuses: readonly PodcastOperationStatus[] = [
  "in_progress",
  "stuck",
  "completed",
  "cancelled",
];

export const podcastOperationStatusLabels: Record<PodcastOperationStatus, string> = {
  in_progress: "In Progress",
  stuck: "Stuck",
  completed: "Completed",
  cancelled: "Cancelled",
};

export type PodcastOperationItem = {
  /**
   * Spreadsheet rows carry no stable identity of their own — derived from
   * position (source month + section + row index), stable within one parse
   * but not a persistent cross-fetch id. Fine for a read-only, non-mutating
   * view; never used as a foreign key anywhere.
   */
  id: string;
  sourceMonth: string;
  sourceSection: string;

  clientName: string;
  email: string | null;
  loginUrl: string | null;
  orderNumber: string | null;
  /** The literal Sheet cell, untouched — kept for parser/source debugging. Never rendered directly; see `workLabel`. */
  rawSeoPackage: string | null;
  /**
   * The Operations-facing Work label, derived from the local block schema
   * (see `deriveWorkLabel`) — never from client name, VA, status, row
   * number, or section title. `null` only when the block itself has an SEO
   * Package column but this row's cell is blank; a block with no SEO
   * Package column always resolves to the fixed Partnership label.
   */
  workLabel: string | null;
  primaryKeyword: string | null;
  city: string | null;
  promptSopUrl: string | null;
  podcastUrl: string | null;

  normalizedStatus: PodcastOperationStatus;
  rawStatus: string;

  notes: string | null;
  assignedVa: string | null;
};

type PodcastFieldKey =
  | "clientName"
  | "email"
  | "loginUrl"
  | "orderNumber"
  | "seoPackage"
  | "primaryKeyword"
  | "city"
  | "promptSopUrl"
  | "podcastUrl"
  | "rawStatus"
  | "notes"
  | "assignedVa";

/**
 * One entry per recognized header spelling, lower-cased with whitespace
 * collapsed. The "current source columns" from the primary table are listed
 * first; the rest are reasonable variants for the workbook's other partial
 * Podcast blocks, since those are not guaranteed to use identical headers.
 */
const HEADER_ALIASES: Record<PodcastFieldKey, readonly string[]> = {
  clientName: ["name", "client", "client name"],
  email: ["email", "email address"],
  loginUrl: ["logins", "login", "login url", "login document", "login doc"],
  orderNumber: ["order #", "order number", "order no", "order"],
  seoPackage: ["seo package", "package"],
  primaryKeyword: ["primary keyword", "keyword", "keywords"],
  city: ["city"],
  promptSopUrl: ["prompt / sop", "prompt/sop", "prompt sop", "prompt", "sop"],
  podcastUrl: ["podcast link", "podcast url", "podcast", "podcast episode"],
  rawStatus: ["status 1", "status"],
  notes: ["notes", "note"],
  assignedVa: ["assigned va", "assigned  va", "va", "va assigned"],
};

function normalizeHeaderCell(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchHeaderField(cell: string): PodcastFieldKey | null {
  const normalized = normalizeHeaderCell(cell);
  if (!normalized) return null;
  for (const field of Object.keys(HEADER_ALIASES) as PodcastFieldKey[]) {
    if (HEADER_ALIASES[field].includes(normalized)) return field;
  }
  return null;
}

/**
 * A row counts as a section header only once it recognizably names at least
 * two columns, including either the client-identity column or the status
 * column — strict enough that an ordinary data row (which might happen to
 * contain the word "status" inside free text) does not get misread as a new
 * block boundary, permissive enough that a smaller partner block's own
 * (possibly shorter) header row is still recognized.
 */
function matchHeaderRow(row: readonly string[]): Partial<Record<number, PodcastFieldKey>> | null {
  const map: Partial<Record<number, PodcastFieldKey>> = {};
  const seen = new Set<PodcastFieldKey>();
  row.forEach((rawCell, index) => {
    const field = matchHeaderField(rawCell);
    if (field && !seen.has(field)) {
      map[index] = field;
      seen.add(field);
    }
  });
  if (seen.size < 2) return null;
  if (!seen.has("clientName") && !seen.has("rawStatus")) return null;
  return map;
}

function cellFor(
  row: readonly string[],
  columnMap: Partial<Record<number, PodcastFieldKey>>,
  field: PodcastFieldKey,
): string | null {
  for (const [index, mappedField] of Object.entries(columnMap)) {
    if (mappedField !== field) continue;
    const value = row[Number(index)]?.trim();
    return value ? value : null;
  }
  return null;
}

/**
 * `\bcancell?ed\b` matches "CANCELLED"/"canceled" as a whole word, checked
 * before the raw-status mapping below — the one documented inconsistent
 * source case (Status says Completed, Notes says CANCELLED) resolves to
 * Cancelled. A note like "not cancelled" would also match; V1 accepts that
 * limitation rather than attempting negation detection over free text.
 */
const CANCELLED_NOTE_PATTERN = /\bcancell?ed\b/i;

export function normalizePodcastStatus(
  rawStatus: string,
  notes: string | null,
): PodcastOperationStatus {
  if (notes && CANCELLED_NOTE_PATTERN.test(notes)) return "cancelled";

  const normalized = rawStatus.trim().toLowerCase();
  if (!normalized) return "in_progress";
  if (normalized === "completed" || normalized === "complete") return "completed";
  if (normalized === "stuck") return "stuck";
  if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
  if (normalized === "in progress" || normalized === "inprogress" || normalized === "paused") {
    return "in_progress";
  }
  return "in_progress";
}

/** Appended to a normal package block's raw SEO Package value for Operations display. */
const PACKAGE_WORK_SUFFIX = "4/4";
/** The fixed Work label for any block whose local header has no SEO Package column at all. */
const PARTNERSHIP_WORK_LABEL = "Partnership 10/10";
const ALREADY_SUFFIXED_PATTERN = /\s4\/4$/;

const SEO_SUCCESS_BLUEPRINT_PATTERN = /seo success blueprint/i;
const SEO_SUCCESS_BLUEPRINT_ABBREVIATION = "SBP";

/**
 * Operations-display-only shortening — "SEO Success Blueprint" anywhere in a
 * raw package name becomes "SBP" (e.g. "Platinum SEO Success Blueprint (100
 * Targeted Keywords)" -> "Platinum SBP (100 Targeted Keywords)"). Never
 * applied to `rawSeoPackage` itself, only to the derived `workLabel`, so the
 * original Sheet value is always still available for search and debugging.
 * A single reusable helper rather than each surface re-implementing the
 * replace is what keeps every display of a package name in sync.
 */
export function abbreviatePackageLabel(rawSeoPackage: string): string {
  return rawSeoPackage.replace(SEO_SUCCESS_BLUEPRINT_PATTERN, SEO_SUCCESS_BLUEPRINT_ABBREVIATION);
}

/** "Platinum" -> "Platinum 4/4"; "SEO Success Blueprint" -> "SBP 4/4"; already-suffixed -> unchanged. */
function withPackageWorkSuffix(rawSeoPackage: string): string {
  const abbreviated = abbreviatePackageLabel(rawSeoPackage.trim());
  return ALREADY_SUFFIXED_PATTERN.test(abbreviated) ? abbreviated : `${abbreviated} ${PACKAGE_WORK_SUFFIX}`;
}

/**
 * The one place "4/4" vs "Partnership 10/10" is decided — from whether the
 * *local block's header* named an SEO Package column at all, never from any
 * per-row signal (client name, VA, status, Podcast Link presence, section
 * title). A block without that column is a partnership/compact block by
 * definition; no raw package value is ever guessed for it.
 */
function deriveWorkLabel(
  rawSeoPackage: string | null,
  columnMap: Partial<Record<number, PodcastFieldKey>>,
): string | null {
  const blockHasSeoPackageColumn = Object.values(columnMap).includes("seoPackage");
  if (!blockHasSeoPackageColumn) return PARTNERSHIP_WORK_LABEL;
  return rawSeoPackage ? withPackageWorkSuffix(rawSeoPackage) : null;
}

function buildItem(
  row: readonly string[],
  columnMap: Partial<Record<number, PodcastFieldKey>>,
  sourceMonth: string,
  sourceSection: string,
  rowIndex: number,
): PodcastOperationItem | null {
  const clientName = cellFor(row, columnMap, "clientName");
  if (!clientName) return null;

  const rawStatus = cellFor(row, columnMap, "rawStatus") ?? "";
  const notes = cellFor(row, columnMap, "notes");
  const rawSeoPackage = cellFor(row, columnMap, "seoPackage");

  return {
    id: `${sourceMonth}::${sourceSection}::${rowIndex}`,
    sourceMonth,
    sourceSection,
    clientName,
    email: cellFor(row, columnMap, "email"),
    loginUrl: cellFor(row, columnMap, "loginUrl"),
    orderNumber: cellFor(row, columnMap, "orderNumber"),
    rawSeoPackage,
    workLabel: deriveWorkLabel(rawSeoPackage, columnMap),
    primaryKeyword: cellFor(row, columnMap, "primaryKeyword"),
    city: cellFor(row, columnMap, "city"),
    promptSopUrl: cellFor(row, columnMap, "promptSopUrl"),
    podcastUrl: cellFor(row, columnMap, "podcastUrl"),
    normalizedStatus: normalizePodcastStatus(rawStatus, notes),
    rawStatus,
    notes,
    assignedVa: cellFor(row, columnMap, "assignedVa"),
  };
}

/**
 * Turns one Podcast SEO tab's raw grid into canonical work items.
 *
 * The workbook is not one flat table — the primary Podcast table is followed
 * by smaller partner/account blocks with their own (partial) header rows.
 * This walks the grid once, top to bottom, re-establishing the active column
 * mapping every time a new header row is recognized, so each block is read
 * against its own schema instead of the first one seen. A short row with no
 * client-column value while a block is active is treated as a section title
 * or separator, never as a work item — the only floor for "is a work item"
 * is a populated client-identity cell.
 *
 * Title detection uses lookahead, not column position: a lone cell in the
 * client-name column is structurally identical whether it is a genuine
 * one-field client row or a section title, so the only reliable signal is
 * what comes right after it. A short (at most two populated cells) row is
 * treated as the *next* block's title only when the next non-blank row is
 * itself a header row — never merely because it is short. This is a
 * heuristic, not a semantic read of the sheet: a truly minimal client row
 * sitting immediately before another block's header would be misread as
 * that block's title. Accepted for V1 given no live workbook to calibrate
 * against; documented rather than silently possible.
 */
type BlockDataRow = {
  rowIndex: number;
  row: readonly string[];
  columnMap: Partial<Record<number, PodcastFieldKey>>;
  sectionLabel: string;
};

/**
 * The single block-boundary walk shared by `parsePodcastWorkflowRows` (which
 * turns each yielded row into a work item) and `locateAssignedVaColumns`
 * (which only needs to know where the Assigned VA column lives per block).
 * Keeping this in one place is what guarantees both callers agree on what
 * counts as a header row, a title row, and a block boundary.
 */
function walkPodcastBlockRows(rows: readonly (readonly string[])[]): BlockDataRow[] {
  const normalizedRows = rows.map((row) => row.map((cell) => cell ?? ""));
  const isBlankRow = normalizedRows.map((row) => row.every((cell) => cell.trim().length === 0));
  const headerMaps = normalizedRows.map((row) => matchHeaderRow(row));

  function nextNonBlankIsHeader(fromIndex: number): boolean {
    for (let index = fromIndex + 1; index < normalizedRows.length; index += 1) {
      if (isBlankRow[index]) continue;
      return headerMaps[index] !== null;
    }
    return false;
  }

  const dataRows: BlockDataRow[] = [];
  let columnMap: Partial<Record<number, PodcastFieldKey>> | null = null;
  let sectionLabel = "Podcast SEO";
  let pendingTitle: string | null = null;
  let blockCount = 0;

  normalizedRows.forEach((row, rowIndex) => {
    if (isBlankRow[rowIndex]) return;

    const headerMap = headerMaps[rowIndex];
    if (headerMap) {
      columnMap = headerMap;
      blockCount += 1;
      sectionLabel = pendingTitle ?? (blockCount === 1 ? "Podcast SEO" : `Podcast SEO (block ${blockCount})`);
      pendingTitle = null;
      return;
    }

    const nonEmpty = row.filter((cell) => cell.trim().length > 0);
    if (nonEmpty.length <= 2 && nextNonBlankIsHeader(rowIndex)) {
      pendingTitle = nonEmpty.join(" ").trim();
      return;
    }

    if (!columnMap) return;

    dataRows.push({ rowIndex, row, columnMap, sectionLabel });
  });

  return dataRows;
}

export function parsePodcastWorkflowRows(
  rows: readonly (readonly string[])[],
  sourceMonth: string,
): PodcastOperationItem[] {
  const items: PodcastOperationItem[] = [];
  for (const { rowIndex, row, columnMap, sectionLabel } of walkPodcastBlockRows(rows)) {
    const item = buildItem(row, columnMap, sourceMonth, sectionLabel, rowIndex);
    if (item) items.push(item);
  }
  return items;
}

/**
 * Every distinct column index that some recognized header row in this tab
 * maps to Assigned VA — one entry per block that has the column, in header
 * order. Read by the Sheets adapter to know exactly which column(s) to pull
 * data-validation rules from, so a VA that currently has zero rows (and so
 * never appears in any parsed item) is still discoverable from the sheet's
 * own dropdown definition rather than only from populated cells.
 */
export function locateAssignedVaColumns(rows: readonly (readonly string[])[]): number[] {
  const columns = new Set<number>();
  for (const row of rows) {
    const headerMap = matchHeaderRow(row.map((cell) => cell ?? ""));
    if (!headerMap) continue;
    for (const [index, field] of Object.entries(headerMap)) {
      if (field === "assignedVa") columns.add(Number(index));
    }
  }
  return [...columns].sort((a, b) => a - b);
}

function normalizeVaDisplayValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * The Assigned VA filter's option list: every value the sheet's own
 * data-validation dropdown allows, unioned with every Assigned VA value
 * actually found in parsed records — never just the latter, which would
 * silently hide a valid assignee the moment their last Podcast row clears.
 * Whitespace is normalized and matching is case-insensitive so "LayLay" and
 * "laylay " collapse to one option; the first-seen (validation-first) casing
 * wins as the clean display value.
 */
export function mergeAssignedVaOptions(
  validationOptions: readonly string[],
  items: readonly PodcastOperationItem[],
): string[] {
  const displayByKey = new Map<string, string>();
  function add(value: string): void {
    const display = normalizeVaDisplayValue(value);
    if (!display) return;
    const key = display.toLowerCase();
    if (!displayByKey.has(key)) displayByKey.set(key, display);
  }

  for (const option of validationOptions) add(option);
  for (const item of items) if (item.assignedVa) add(item.assignedVa);

  return [...displayByKey.values()].sort((a, b) => a.localeCompare(b));
}
