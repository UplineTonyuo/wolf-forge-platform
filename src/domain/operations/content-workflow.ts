/**
 * Content department workflow — a pure, Content-specific read model.
 * Google Sheets rows stay outside Team Tasks and order-task storage; this
 * parser only normalizes an external read-only workflow for Operations UI.
 */

export type ContentOperationStatus = "in_progress" | "stuck" | "completed" | "cancelled";

export const contentOperationStatuses: readonly ContentOperationStatus[] = [
  "in_progress",
  "stuck",
  "completed",
  "cancelled",
];

export const contentOperationStatusLabels: Record<ContentOperationStatus, string> = {
  in_progress: "In Progress",
  stuck: "Stuck",
  completed: "Completed",
  cancelled: "Cancelled",
};

export type ContentOperationItem = {
  id: string;
  sourceTab: string;
  sourceSection: string;
  website: string;
  email: string | null;
  loginUrl: string | null;
  orderNumber: string | null;
  seoPackage: string | null;
  primaryKeyword: string | null;
  city: string | null;
  promptSopUrl: string | null;
  blogContent: string | null;
  normalizedStatus: ContentOperationStatus;
  rawStatus: string;
};

type ContentFieldKey =
  | "website"
  | "email"
  | "loginUrl"
  | "orderNumber"
  | "seoPackage"
  | "primaryKeyword"
  | "city"
  | "promptSopUrl"
  | "blogContent"
  | "rawStatus";

const HEADER_ALIASES: Record<ContentFieldKey, readonly string[]> = {
  website: ["website", "website url", "site", "site url", "url"],
  email: ["email", "email address"],
  loginUrl: ["logins", "login", "login url", "login document", "login doc"],
  orderNumber: ["order #", "order number", "order no", "order"],
  seoPackage: ["seo package", "package"],
  primaryKeyword: ["primary keyword", "keyword", "keywords"],
  city: ["city", "location"],
  promptSopUrl: ["prompt / sop", "prompt/sop", "prompt sop", "prompt", "sop"],
  blogContent: [
    "4 blog content",
    "four blog content",
    "4 blogs",
    "blog content",
    "blog content link",
    "content output",
  ],
  rawStatus: ["status", "workflow status", "content status"],
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function fieldForHeader(value: string): ContentFieldKey | null {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  for (const field of Object.keys(HEADER_ALIASES) as ContentFieldKey[]) {
    if (HEADER_ALIASES[field].includes(normalized)) return field;
  }
  return null;
}

type ColumnMap = Partial<Record<number, ContentFieldKey>>;

function matchHeaderRow(row: readonly string[]): ColumnMap | null {
  const columns: ColumnMap = {};
  const seen = new Set<ContentFieldKey>();
  row.forEach((cell, index) => {
    const field = fieldForHeader(cell);
    if (field && !seen.has(field)) {
      columns[index] = field;
      seen.add(field);
    }
  });
  if (seen.size < 2) return null;
  if (!seen.has("website") && !seen.has("rawStatus")) return null;
  return columns;
}

function cellFor(row: readonly string[], columns: ColumnMap, field: ContentFieldKey): string | null {
  for (const [index, mappedField] of Object.entries(columns)) {
    if (mappedField !== field) continue;
    const value = row[Number(index)]?.trim();
    return value ? value : null;
  }
  return null;
}

export function normalizeContentStatus(rawStatus: string): ContentOperationStatus {
  const normalized = rawStatus.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (["complete", "completed", "done", "published"].includes(normalized)) return "completed";
  if (["stuck", "blocked", "needs attention"].includes(normalized)) return "stuck";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
  return "in_progress";
}

type ContentBlockRow = {
  row: readonly string[];
  rowIndex: number;
  columns: ColumnMap;
  section: string;
};

function walkContentBlocks(rows: readonly (readonly string[])[]): ContentBlockRow[] {
  const normalizedRows = rows.map((row) => row.map((cell) => cell ?? ""));
  const headerMaps = normalizedRows.map(matchHeaderRow);
  const isBlank = normalizedRows.map((row) => row.every((cell) => cell.trim() === ""));

  function nextNonBlankIsHeader(fromIndex: number): boolean {
    for (let index = fromIndex + 1; index < normalizedRows.length; index += 1) {
      if (isBlank[index]) continue;
      return headerMaps[index] !== null;
    }
    return false;
  }

  const dataRows: ContentBlockRow[] = [];
  let columns: ColumnMap | null = null;
  let pendingTitle: string | null = null;
  let section = "Content";
  let blockCount = 0;

  normalizedRows.forEach((row, rowIndex) => {
    if (isBlank[rowIndex]) return;
    const header = headerMaps[rowIndex];
    if (header) {
      columns = header;
      blockCount += 1;
      section = pendingTitle ?? (blockCount === 1 ? "Content" : `Content (block ${blockCount})`);
      pendingTitle = null;
      return;
    }

    const populated = row.filter((cell) => cell.trim() !== "");
    if (populated.length <= 2 && nextNonBlankIsHeader(rowIndex)) {
      pendingTitle = populated.join(" ").trim();
      return;
    }
    if (columns) dataRows.push({ row, rowIndex, columns, section });
  });

  return dataRows;
}

export function parseContentWorkflowRows(
  rows: readonly (readonly string[])[],
  sourceTab: string,
): ContentOperationItem[] {
  const items: ContentOperationItem[] = [];
  for (const { row, rowIndex, columns, section } of walkContentBlocks(rows)) {
    const website = cellFor(row, columns, "website");
    if (!website) continue;
    const rawStatus = cellFor(row, columns, "rawStatus") ?? "";
    items.push({
      id: `${sourceTab}::${section}::${rowIndex}`,
      sourceTab,
      sourceSection: section,
      website,
      email: cellFor(row, columns, "email"),
      loginUrl: cellFor(row, columns, "loginUrl"),
      orderNumber: cellFor(row, columns, "orderNumber"),
      seoPackage: cellFor(row, columns, "seoPackage"),
      primaryKeyword: cellFor(row, columns, "primaryKeyword"),
      city: cellFor(row, columns, "city"),
      promptSopUrl: cellFor(row, columns, "promptSopUrl"),
      blogContent: cellFor(row, columns, "blogContent"),
      normalizedStatus: normalizeContentStatus(rawStatus),
      rawStatus,
    });
  }
  return items;
}
