/**
 * Pure read model for the external, read-only Off-page SEO workflow.
 *
 * Off-page is a multi-deliverable fulfillment workflow: each client has several
 * independent off-page tasks (press releases, directory listings, citations,
 * authority "stack" work) tracked as output+status column pairs. Blocks vary in
 * which deliverables they define — a reduced "Local SEO" block may carry only
 * Citations+Directories — so applicability is always derived from that block's
 * own header, never a fixed universal set.
 *
 * Two real source conventions were verified against the live workbook before
 * being encoded here (see the Off-page implementation log entry for evidence):
 *  - A deliverable's own output cell sometimes holds "NO" (or "NO PR"/"NO GMB")
 *    instead of a link or blank. This is NOT reliably "not applicable" — the
 *    same client can show "NO" in one month's output cell while that same
 *    deliverable's adjacent status cell explicitly reads "Done on JULY" (i.e.
 *    genuinely completed, just with no link stored). "NO" is therefore treated
 *    as ambiguous free text: preserved for display, never used to exclude a
 *    deliverable from the applicable count or to force any status.
 *  - When a deliverable's status cell is blank but its output cell holds a
 *    recognizable status word instead of a link (e.g. "PAUSED", "CANCELLED"),
 *    that word is treated as the real status, not as output text.
 */

export type OffPageDeliverableState =
  | "not_started"
  | "in_progress"
  | "completed"
  | "stuck"
  | "paused"
  | "cancelled";

export type OffPageOperationStatus = OffPageDeliverableState;

export const offPageOperationStatuses: readonly OffPageOperationStatus[] = [
  "not_started",
  "in_progress",
  "stuck",
  "paused",
  "cancelled",
  "completed",
];

export const offPageOperationStatusLabels: Record<OffPageOperationStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  stuck: "Stuck",
  paused: "Paused",
  cancelled: "Cancelled",
};

export type OffPageDeliverable = {
  key: string;
  label: string;
  state: OffPageDeliverableState;
  rawStatus: string | null;
  output: string | null;
  outputUrl: string | null;
};

export type OffPageOperationItem = {
  id: string;
  sourceTab: string;
  sourceSection: string;
  sourceRow: number;
  client: string;
  clientUrl: string | null;
  email: string | null;
  loginUrl: string | null;
  orderNumber: string | null;
  seoPackage: string | null;
  primaryKeyword: string | null;
  city: string | null;
  deliverables: OffPageDeliverable[];
  completedDeliverables: number;
  applicableDeliverables: number;
  normalizedStatus: OffPageOperationStatus;
  /** The single most relevant real blocker/pause/cancellation signal, or null when there is none. Never invented. */
  attention: string | null;
};

type IdentityField = "client" | "email" | "login" | "orderNumber" | "seoPackage" | "primaryKeyword" | "city";

type HeaderField =
  | { type: "identity"; field: IdentityField }
  | { type: "deliverable"; key: string; label: string }
  | { type: "status" };

type DeliverableColumn = { index: number; statusIndex: number | null; key: string; label: string };
type HeaderMap = { identities: Partial<Record<IdentityField, number>>; deliverables: DeliverableColumn[] };

const IDENTITY_ALIASES: Record<string, IdentityField> = {
  name: "client",
  client: "client",
  website: "client",
  "website url": "client",
  email: "email",
  "email address": "email",
  login: "login",
  logins: "login",
  "login ob": "login",
  "logins ob": "login",
  "logins ob sheets": "login",
  "order #": "orderNumber",
  "order number": "orderNumber",
  "seo package": "seoPackage",
  package: "seoPackage",
  "primary keyword": "primaryKeyword",
  keyword: "primaryKeyword",
  city: "city",
};

/** Canonical deliverable identity. Different blocks label the same real task differently (e.g. "100 Citation" vs "One-time setup of 100 Citations"); both resolve to one key so progress and grouping stay consistent. */
const DELIVERABLE_ALIASES: Record<string, { key: string; label: string }> = {
  "4 press releases": { key: "press-release", label: "4 Press Releases" },
  "4 press release": { key: "press-release", label: "4 Press Releases" },
  "one time setup of 100 directory listings": { key: "directory-listings", label: "100 Directory Listings" },
  "100 directories": { key: "directory-listings", label: "100 Directory Listings" },
  "one time setup of 100 citations": { key: "citations", label: "100 Citations" },
  "100 citation": { key: "citations", label: "100 Citations" },
  "100 citations": { key: "citations", label: "100 Citations" },
  cloudstack: { key: "cloudstack", label: "Cloudstack" },
  "advance gstack": { key: "advance-gstack", label: "Advance Gstack" },
  "advanced gstack": { key: "advance-gstack", label: "Advance Gstack" },
  "infinity id loop": { key: "infinity-id-loop", label: "Infinity ID Loop" },
  "one time setup web 2.0 backlinks": { key: "web2-backlinks-setup", label: "One-time Setup Web 2.0 Backlinks" },
  "50+ branded web 2.0 backlinks": { key: "web2-backlinks-branded", label: "50+ Branded Web 2.0 Backlinks" },
  "geo prominence boosters": { key: "geo-prominence", label: "Geo Prominence Boosters" },
};

/** Conceptual off-page work groups for the inspector. A deliverable not in either group (e.g. Web 2.0 Backlinks, Geo Prominence Boosters — real fields the source defines that don't fit the two named groups) is shown ungrouped rather than forced into one. */
export const OFF_PAGE_DELIVERABLE_GROUPS: { title: string; keys: readonly string[] }[] = [
  { title: "Foundational / Promotion", keys: ["press-release", "directory-listings", "citations"] },
  { title: "Authority / Stack Work", keys: ["cloudstack", "advance-gstack", "infinity-id-loop"] },
];

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\/_-]+/g, " ").replace(/\s+/g, " ");
}

/** A block may append a trailing month word to an otherwise-recognized deliverable label (a real observed variant: "4 Press Releases June"). Strip it before alias lookup rather than enumerating every month. */
function canonicalizeDeliverableLabel(normalized: string): string {
  return normalized.replace(/^(4 press releases?)\b.*$/, "$1");
}

function classifyHeader(value: string): HeaderField | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const normalized = normalize(trimmed);
  if (/^status(\s*\d+)?$/.test(normalized)) return { type: "status" };
  const identity = IDENTITY_ALIASES[normalized];
  if (identity) return { type: "identity", field: identity };
  const deliverable = DELIVERABLE_ALIASES[canonicalizeDeliverableLabel(normalized)];
  return deliverable ? { type: "deliverable", ...deliverable } : null;
}

/** A deliverable's status column may have a blank header instead of "Status" (a real, verified source typo pattern) — the immediately following column is still its status. */
function isStatusColumn(headerCell: string | undefined): boolean {
  const trimmed = (headerCell ?? "").trim();
  return trimmed === "" || /^status(\s*\d+)?$/i.test(trimmed);
}

function matchHeaderRow(row: readonly string[]): HeaderMap | null {
  const classified = row.map(classifyHeader);
  const hasClient = classified.some((field) => field?.type === "identity" && field.field === "client");
  const deliverableCount = classified.filter((field) => field?.type === "deliverable").length;
  const recognized = classified.filter(Boolean);
  if (!hasClient || recognized.length < 2 || deliverableCount === 0) return null;

  const identities: Partial<Record<IdentityField, number>> = {};
  const deliverables: DeliverableColumn[] = [];
  classified.forEach((field, index) => {
    if (field?.type === "identity" && identities[field.field] === undefined) identities[field.field] = index;
    if (field?.type !== "deliverable") return;
    deliverables.push({
      index,
      statusIndex: isStatusColumn(row[index + 1]) ? index + 1 : null,
      key: field.key,
      label: field.label,
    });
  });
  return { identities, deliverables };
}

function cell(row: readonly string[], index: number | undefined): string | null {
  if (index === undefined) return null;
  const value = row[index]?.trim();
  return value ? value : null;
}

function findHttpUrl(value: string | null): string | null {
  if (!value) return null;
  return value.match(/https?:\/\/[^\s]+/i)?.[0] ?? null;
}

/** Preserves distinctive raw wording (e.g. "Done on  JULY") in the caller via rawStatus; this only maps to the coarse state used for progress/precedence. */
export function normalizeOffPageState(rawStatus: string | null): OffPageDeliverableState | null {
  const normalized = normalize(rawStatus ?? "");
  if (!normalized) return null;
  if (normalized.startsWith("done") || ["complete", "completed"].includes(normalized)) return "completed";
  if (["stuck", "blocked"].includes(normalized)) return "stuck";
  if (["paused", "pause", "on hold"].includes(normalized)) return "paused";
  if (["cancelled", "canceled", "cancel"].includes(normalized)) return "cancelled";
  if (["in progress", "inprogress", "working", "working on it", "ip"].includes(normalized)) return "in_progress";
  if (["not started", "pending", "to do", "todo"].includes(normalized)) return "not_started";
  return null;
}

/**
 * A deliverable's own explicit status cell always governs when present. When it is
 * blank, an output cell that is itself a recognizable status word (a verified real
 * pattern: "PAUSED"/"CANCELLED" typed into the output slot with the status cell left
 * empty) is treated as the true status rather than as freeform output text. Anything
 * else non-URL (e.g. "NO", "IP", a stray note) is preserved as display-only output
 * text and never used to infer a state — ambiguous source text must not manufacture
 * a progress or status conclusion.
 */
function deliveryState(rawStatusCell: string | null, rawOutput: string | null): { state: OffPageDeliverableState; rawStatus: string | null; output: string | null } {
  if (rawStatusCell) {
    return { state: normalizeOffPageState(rawStatusCell) ?? (findHttpUrl(rawOutput) ? "in_progress" : "not_started"), rawStatus: rawStatusCell, output: rawOutput };
  }
  const outputAsState = normalizeOffPageState(rawOutput);
  if (outputAsState) return { state: outputAsState, rawStatus: rawOutput, output: null };
  return { state: findHttpUrl(rawOutput) ? "in_progress" : "not_started", rawStatus: null, output: rawOutput };
}

function overallStatus(deliverables: readonly OffPageDeliverable[]): OffPageOperationStatus {
  const states = deliverables.map((deliverable) => deliverable.state);
  if (states.includes("stuck")) return "stuck";
  if (states.includes("paused")) return "paused";
  if (states.includes("cancelled")) return "cancelled";
  if (states.length > 0 && states.every((state) => state === "completed")) return "completed";
  if (states.some((state) => state !== "not_started")) return "in_progress";
  return "not_started";
}

/** The most relevant real signal behind an attention-worthy overall status. Never invents text: prefers the offending deliverable's own raw note, falls back to its label, and is null when the client needs no attention. */
function attentionSignal(status: OffPageOperationStatus, deliverables: readonly OffPageDeliverable[]): string | null {
  if (status !== "stuck" && status !== "paused" && status !== "cancelled") return null;
  const offending = deliverables.find((deliverable) => deliverable.state === status);
  if (!offending) return offPageOperationStatusLabels[status];
  return offending.output && !offending.outputUrl
    ? `${offending.label}: ${offending.output}`
    : `${offending.label} ${offPageOperationStatusLabels[status].toLowerCase()}`;
}

type BlockRow = { row: readonly string[]; rowIndex: number; header: HeaderMap; section: string };

function walkBlocks(rows: readonly (readonly string[])[]): BlockRow[] {
  const normalizedRows = rows.map((row) => row.map((value) => value ?? ""));
  const headers = normalizedRows.map(matchHeaderRow);
  const blank = normalizedRows.map((row) => row.every((value) => !value.trim()));
  const output: BlockRow[] = [];
  let header: HeaderMap | null = null;
  let section = "Off-page SEO";
  let pendingTitle: string | null = null;
  let blockCount = 0;

  function nextNonBlankIsHeader(rowIndex: number): boolean {
    for (let index = rowIndex + 1; index < normalizedRows.length; index += 1) {
      if (blank[index]) continue;
      return headers[index] !== null;
    }
    return false;
  }

  normalizedRows.forEach((row, rowIndex) => {
    if (blank[rowIndex]) return;
    const matched = headers[rowIndex];
    if (matched) {
      header = matched;
      blockCount += 1;
      section = pendingTitle ?? (blockCount === 1 ? "Off-page SEO" : `Off-page SEO (block ${blockCount})`);
      pendingTitle = null;
      return;
    }
    const populated = row.filter((value) => value.trim());
    if (populated.length === 1 && nextNonBlankIsHeader(rowIndex)) {
      pendingTitle = populated[0]!.trim();
      return;
    }
    if (header) output.push({ row, rowIndex, header, section });
  });
  return output;
}

export function locateOffPageSeoLinkColumns(rows: readonly (readonly string[])[]): number[] {
  const columns = new Set<number>();
  for (const row of rows) {
    const header = matchHeaderRow(row);
    if (!header) continue;
    for (const field of ["client", "login"] as const) {
      const index = header.identities[field];
      if (index !== undefined) columns.add(index);
    }
    for (const deliverable of header.deliverables) columns.add(deliverable.index);
  }
  return [...columns].sort((left, right) => left - right);
}

export function parseOffPageSeoWorkflowRows(rows: readonly (readonly string[])[], sourceTab: string): OffPageOperationItem[] {
  return walkBlocks(rows).flatMap(({ row, rowIndex, header, section }) => {
    const client = cell(row, header.identities.client);
    if (!client) return [];
    const deliverables: OffPageDeliverable[] = header.deliverables.map((definition) => {
      const rawOutput = cell(row, definition.index);
      const rawStatusCell = cell(row, definition.statusIndex ?? undefined);
      const resolved = deliveryState(rawStatusCell, rawOutput);
      return { key: definition.key, label: definition.label, state: resolved.state, rawStatus: resolved.rawStatus, output: resolved.output, outputUrl: findHttpUrl(resolved.output) };
    });
    const completedDeliverables = deliverables.filter((deliverable) => deliverable.state === "completed").length;
    const normalizedStatus = overallStatus(deliverables);
    return [{
      id: `${sourceTab}::${section}::${rowIndex}`,
      sourceTab,
      sourceSection: section,
      sourceRow: rowIndex + 1,
      client,
      clientUrl: findHttpUrl(client),
      email: cell(row, header.identities.email),
      loginUrl: findHttpUrl(cell(row, header.identities.login)),
      orderNumber: cell(row, header.identities.orderNumber),
      seoPackage: cell(row, header.identities.seoPackage),
      primaryKeyword: cell(row, header.identities.primaryKeyword),
      city: cell(row, header.identities.city),
      deliverables,
      completedDeliverables,
      applicableDeliverables: deliverables.length,
      normalizedStatus,
      attention: attentionSignal(normalizedStatus, deliverables),
    } satisfies OffPageOperationItem];
  });
}
