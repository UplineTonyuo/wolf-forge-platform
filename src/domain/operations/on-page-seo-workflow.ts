/** Pure read model for the external, read-only On-page SEO workflow. */

export type OnPageSeoDeliverableState =
  | "not_started"
  | "in_progress"
  | "completed"
  | "stuck"
  | "paused"
  | "cancelled";

export type OnPageSeoOperationStatus = OnPageSeoDeliverableState;

export const onPageSeoOperationStatuses: readonly OnPageSeoOperationStatus[] = [
  "not_started",
  "in_progress",
  "stuck",
  "paused",
  "cancelled",
  "completed",
];

export const onPageSeoOperationStatusLabels: Record<OnPageSeoOperationStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  stuck: "Stuck",
  paused: "Paused",
  cancelled: "Cancelled",
};

export type OnPageSeoDeliverable = {
  key: string;
  label: string;
  state: OnPageSeoDeliverableState;
  rawStatus: string | null;
  output: string | null;
  outputUrl: string | null;
};

export type OnPageSeoOperationItem = {
  id: string;
  sourceTab: string;
  sourceSection: string;
  client: string;
  clientUrl: string | null;
  email: string | null;
  loginUrl: string | null;
  assignedVa: string | null;
  assignmentSourceValue: string | null;
  owner: string | null;
  orderNumber: string | null;
  seoPackage: string | null;
  primaryKeyword: string | null;
  city: string | null;
  promptSopUrl: string | null;
  deliverables: OnPageSeoDeliverable[];
  completedDeliverables: number;
  applicableDeliverables: number;
  normalizedStatus: OnPageSeoOperationStatus;
};

type IdentityField =
  | "client"
  | "email"
  | "login"
  | "assignedVa"
  | "owner"
  | "orderNumber"
  | "seoPackage"
  | "primaryKeyword"
  | "city"
  | "promptSop";

type HeaderField =
  | { type: "identity"; field: IdentityField }
  | { type: "deliverable"; key: string; label: string }
  | { type: "status" };

type DeliverableColumn = { index: number; statusIndex: number | null; key: string; label: string };
type HeaderMap = {
  identities: Partial<Record<IdentityField, number>>;
  deliverables: DeliverableColumn[];
};

const IDENTITY_ALIASES: Record<string, IdentityField> = {
  name: "client",
  client: "client",
  website: "client",
  "website url": "client",
  email: "email",
  "email address": "email",
  login: "login",
  logins: "login",
  "assigned va": "assignedVa",
  people: "assignedVa",
  owner: "owner",
  "order #": "orderNumber",
  "order number": "orderNumber",
  "seo package": "seoPackage",
  package: "seoPackage",
  "primary keyword": "primaryKeyword",
  city: "city",
  "prompt/ sop": "promptSop",
  "prompt / sop": "promptSop",
  "prompt sop": "promptSop",
};

const DELIVERABLE_ALIASES: Record<string, { key: string; label: string }> = {
  "4 blogs posted per month": { key: "blogs", label: "4 Blogs Posted per Month" },
  "4 blog content": { key: "blogs", label: "4 Blogs Posted per Month" },
  "blog posted": { key: "blogs", label: "Blog Posted" },
  "podcast embed": { key: "podcast-embed", label: "Podcast Embed" },
  "youtube embed": { key: "youtube-embed", label: "YouTube Embed" },
  "onpage audit": { key: "onpage-audit", label: "On-page Audit" },
  "on page audit": { key: "onpage-audit", label: "On-page Audit" },
  "on page optimization": { key: "on-page-optimization", label: "On-page Optimization" },
  "onpage optimization": { key: "on-page-optimization", label: "On-page Optimization" },
  "review call out": { key: "review-callout", label: "Review Call Out" },
  "review callout": { key: "review-callout", label: "Review Call Out" },
  "social icons on & linked": { key: "social-icons", label: "Social Icons on & Linked" },
  "social icons on and linked": { key: "social-icons", label: "Social Icons on & Linked" },
  schema: { key: "schema", label: "Schema" },
  "location page": { key: "location-page", label: "Location Page" },
  "review on homepage and link page": { key: "homepage-review", label: "Review on Homepage and Link Page" },
  "review on homepage": { key: "homepage-review", label: "Review on Homepage" },
  "map on homepage": { key: "homepage-map", label: "Map on Homepage" },
  "pdf in footer": { key: "footer-pdf", label: "PDF in Footer" },
  "keyword research": { key: "keyword-research", label: "Keyword Research" },
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function classifyHeader(value: string): HeaderField | null {
  const normalized = normalize(value);
  if (!normalized) return null;
  if (normalized === "status" || normalized === "workflow status") return { type: "status" };
  const identity = IDENTITY_ALIASES[normalized];
  if (identity) return { type: "identity", field: identity };
  const deliverable = DELIVERABLE_ALIASES[normalized];
  return deliverable ? { type: "deliverable", ...deliverable } : null;
}

function matchHeaderRow(row: readonly string[]): HeaderMap | null {
  const classified = row.map(classifyHeader);
  const recognized = classified.filter(Boolean);
  const hasClient = classified.some((field) => field?.type === "identity" && field.field === "client");
  const deliverableCount = classified.filter((field) => field?.type === "deliverable").length;
  const hasImplicitFirstClientColumn = !row[0]?.trim()
    && deliverableCount >= 3
    && classified.some((field) => field?.type === "identity" && field.field === "email");
  if ((!hasClient && !hasImplicitFirstClientColumn) || recognized.length < 3 || deliverableCount === 0) return null;

  const identities: Partial<Record<IdentityField, number>> = {};
  const deliverables: DeliverableColumn[] = [];
  classified.forEach((field, index) => {
    if (field?.type === "identity" && identities[field.field] === undefined) identities[field.field] = index;
    if (field?.type !== "deliverable") return;
    const nextField = classified[index + 1];
    deliverables.push({
      index,
      statusIndex: nextField?.type === "status" ? index + 1 : null,
      key: field.key,
      label: field.label,
    });
  });
  if (hasImplicitFirstClientColumn) identities.client = 0;
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

export function normalizeOnPageSeoState(rawStatus: string | null): OnPageSeoDeliverableState | null {
  const normalized = normalize(rawStatus ?? "");
  if (!normalized) return null;
  if (["done", "complete", "completed", "published"].includes(normalized)) return "completed";
  if (["stuck", "blocked", "needs attention"].includes(normalized)) return "stuck";
  if (["paused", "on hold"].includes(normalized)) return "paused";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
  if (["in progress", "working", "ongoing"].includes(normalized)) return "in_progress";
  if (["not started", "pending", "todo", "to do"].includes(normalized)) return "not_started";
  return null;
}

const BLOCKING_NOTE = /(need(s)? (login|verification)|site error|login (is )?commented|login does not work|password is incorrect|no site (published|in wix)|page not found)/i;

function deliveryState(rawStatus: string | null, output: string | null): OnPageSeoDeliverableState {
  return normalizeOnPageSeoState(rawStatus) ?? normalizeOnPageSeoState(output) ?? (output ? "in_progress" : "not_started");
}

function looksLikeAssignee(value: string | null): boolean {
  return Boolean(value && !normalizeOnPageSeoState(value) && !BLOCKING_NOTE.test(value));
}

function overallStatus(
  deliverables: readonly OnPageSeoDeliverable[],
  row: readonly string[],
): OnPageSeoOperationStatus {
  const states = deliverables.map((deliverable) => deliverable.state);
  const sourceSignals = row.map((value) => normalizeOnPageSeoState(value)).filter(Boolean);
  if (sourceSignals.includes("stuck") || row.some((value) => BLOCKING_NOTE.test(value))) return "stuck";
  if (sourceSignals.includes("paused")) return "paused";
  if (sourceSignals.includes("cancelled")) return "cancelled";
  if (states.length > 0 && states.every((state) => state === "completed")) return "completed";
  if (states.some((state) => state !== "not_started")) return "in_progress";
  return "not_started";
}

type BlockRow = { row: readonly string[]; rowIndex: number; header: HeaderMap; section: string };

function walkBlocks(rows: readonly (readonly string[])[]): BlockRow[] {
  const normalizedRows = rows.map((row) => row.map((value) => value ?? ""));
  const headers = normalizedRows.map(matchHeaderRow);
  const blank = normalizedRows.map((row) => row.every((value) => !value.trim()));
  const output: BlockRow[] = [];
  let header: HeaderMap | null = null;
  let section = "On-page SEO";
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
      section = pendingTitle ?? (blockCount === 1 ? "On-page SEO" : `On-page SEO (block ${blockCount})`);
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

export function locateOnPageSeoLinkColumns(rows: readonly (readonly string[])[]): number[] {
  const columns = new Set<number>();
  for (const row of rows) {
    const header = matchHeaderRow(row);
    if (!header) continue;
    for (const field of ["client", "login", "promptSop"] as const) {
      const index = header.identities[field];
      if (index !== undefined) columns.add(index);
    }
    for (const deliverable of header.deliverables) columns.add(deliverable.index);
  }
  return [...columns].sort((left, right) => left - right);
}

export function parseOnPageSeoWorkflowRows(
  rows: readonly (readonly string[])[],
  sourceTab: string,
): OnPageSeoOperationItem[] {
  return walkBlocks(rows).flatMap(({ row, rowIndex, header, section }) => {
    const client = cell(row, header.identities.client);
    if (!client) return [];
    const assignmentSourceValue = cell(row, header.identities.assignedVa);
    const deliverables = header.deliverables.map((definition) => {
      const rawOutput = cell(row, definition.index);
      const rawStatus = cell(row, definition.statusIndex ?? undefined);
      const outputIsStatus = definition.statusIndex === null && normalizeOnPageSeoState(rawOutput) !== null;
      const output = outputIsStatus ? null : rawOutput;
      return {
        key: definition.key,
        label: definition.label,
        state: deliveryState(rawStatus, rawOutput),
        rawStatus: rawStatus ?? (outputIsStatus ? rawOutput : null),
        output,
        outputUrl: findHttpUrl(output),
      } satisfies OnPageSeoDeliverable;
    });
    const completedDeliverables = deliverables.filter((deliverable) => deliverable.state === "completed").length;
    return [{
      id: `${sourceTab}::${section}::${rowIndex}`,
      sourceTab,
      sourceSection: section,
      client,
      clientUrl: findHttpUrl(client),
      email: cell(row, header.identities.email),
      loginUrl: findHttpUrl(cell(row, header.identities.login)),
      assignedVa: looksLikeAssignee(assignmentSourceValue) ? assignmentSourceValue : null,
      assignmentSourceValue,
      owner: cell(row, header.identities.owner),
      orderNumber: cell(row, header.identities.orderNumber),
      seoPackage: cell(row, header.identities.seoPackage),
      primaryKeyword: cell(row, header.identities.primaryKeyword),
      city: cell(row, header.identities.city),
      promptSopUrl: findHttpUrl(cell(row, header.identities.promptSop)),
      deliverables,
      completedDeliverables,
      applicableDeliverables: deliverables.length,
      normalizedStatus: overallStatus(deliverables, row),
    }];
  });
}
