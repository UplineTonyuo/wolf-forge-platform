/**
 * Pure read model for the external, read-only Website Builder workflow.
 *
 * Unlike Podcast/Content/GMB/YouTube, this sheet is a flat delivery queue,
 * not a repeating-header stacked-block table: one header row per tab, real
 * project rows beneath it, and occasional single-cell "<Executive> EOD"
 * marker rows that introduce a new owner's section without ever repeating
 * the header. There is also no multi-stage precedence to derive — the
 * sheet's own `Status` column already is the single real pipeline state,
 * and `Bottleneck`/`Actions` are independent free-text fields, not stages.
 */

export type WebsiteBuilderStatusKey =
  | "backlog"
  | "not_started"
  | "waiting_for_domain"
  | "waiting_for_license"
  | "waiting_edits"
  | "in_progress"
  | "completed"
  | "other";

export type WebsiteBuilderStatus = {
  key: WebsiteBuilderStatusKey;
  /** Canonical label for a known key, or the exact source text for "other". */
  label: string;
};

/** Stable left-to-right ordering for the known vocabulary; "other" values are appended per their own real text. */
export const WEBSITE_BUILDER_KNOWN_STATUS_ORDER: readonly WebsiteBuilderStatusKey[] = [
  "backlog",
  "not_started",
  "waiting_for_domain",
  "waiting_for_license",
  "waiting_edits",
  "in_progress",
  "completed",
];

const KNOWN_STATUS_LABELS: Record<Exclude<WebsiteBuilderStatusKey, "other">, string> = {
  backlog: "Backlog",
  not_started: "Not Started",
  waiting_for_domain: "Waiting for Domain",
  waiting_for_license: "Waiting for License",
  waiting_edits: "Waiting Edits",
  in_progress: "In Progress",
  completed: "Completed",
};

const STATUS_ALIASES: Record<string, Exclude<WebsiteBuilderStatusKey, "other" | "not_started">> = {
  backlog: "backlog",
  backog: "backlog",
  "waiting for domain": "waiting_for_domain",
  "waiting for license": "waiting_for_license",
  "waiting edits": "waiting_edits",
  "waiting for edits": "waiting_edits",
  "in progress": "in_progress",
  inprogress: "in_progress",
  completed: "completed",
  complete: "completed",
  done: "completed",
};

export type WebsiteBuilderProject = {
  id: string;
  sourceTab: string;
  sourceSection: string;
  executive: string | null;
  orderNumber: string | null;
  business: string;
  businessUrl: string | null;
  dateOnboarded: string | null;
  ob: string | null;
  obUrl: string | null;
  eta: string | null;
  webContent: string | null;
  webContentUrl: string | null;
  domain: string | null;
  domainUrl: string | null;
  status: WebsiteBuilderStatus;
  bottleneck: string | null;
  actions: string | null;
};

type IdentityField =
  | "executive"
  | "orderNumber"
  | "business"
  | "dateOnboarded"
  | "ob"
  | "eta"
  | "webContent"
  | "domain"
  | "status"
  | "bottleneck"
  | "actions";

const IDENTITY_ALIASES: Record<string, IdentityField> = {
  "executive name": "executive",
  executive: "executive",
  "seo order#": "orderNumber",
  "seo order #": "orderNumber",
  "order #": "orderNumber",
  "business name": "business",
  business: "business",
  "date onboarded": "dateOnboarded",
  ob: "ob",
  eta: "eta",
  "web content": "webContent",
  domain: "domain",
  status: "status",
  bottleneck: "bottleneck",
  actions: "actions",
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function cell(row: readonly string[], index: number | undefined): string | null {
  if (index === undefined) return null;
  const value = row[index]?.trim();
  return value ? value : null;
}

function findHttpUrl(value: string | null): string | null {
  return value?.match(/https?:\/\/[^\s]+/i)?.[0] ?? null;
}

const BARE_DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/\S*)?$/i;

/** A "Domain" cell is often a bare host with no scheme; adds one so it's a real clickable link without inventing a destination. */
function findLinkableUrl(value: string | null): string | null {
  const direct = findHttpUrl(value);
  if (direct) return direct;
  const trimmed = value?.trim();
  if (trimmed && BARE_DOMAIN.test(trimmed)) return `https://${trimmed}`;
  return null;
}

export function normalizeWebsiteBuilderStatus(rawValue: string | null): WebsiteBuilderStatus {
  const trimmed = rawValue?.trim() ?? "";
  if (!trimmed) return { key: "not_started", label: KNOWN_STATUS_LABELS.not_started };
  const key = STATUS_ALIASES[normalize(trimmed)];
  if (key) return { key, label: KNOWN_STATUS_LABELS[key] };
  return { key: "other", label: trimmed };
}

type HeaderMap = Partial<Record<IdentityField, number>>;

function matchHeaderRow(row: readonly string[]): HeaderMap | null {
  const identities: HeaderMap = {};
  row.forEach((value, index) => {
    const identity = IDENTITY_ALIASES[normalize(value)];
    if (identity && identities[identity] === undefined) identities[identity] = index;
  });
  if (identities.business === undefined || identities.status === undefined) return null;
  return identities;
}

/** Rejects an "<Executive> EOD - <url>" section marker so its garbled text never becomes a forward-filled executive value. */
function looksLikePlainName(value: string): boolean {
  return !/https?:\/\//i.test(value) && !/\beod\b/i.test(value);
}

export function locateWebsiteBuilderLinkColumns(rows: readonly (readonly string[])[]): number[] {
  const columns = new Set<number>();
  for (const row of rows) {
    const header = matchHeaderRow(row);
    if (!header) continue;
    for (const field of ["ob", "webContent", "domain"] as const) {
      const index = header[field];
      if (index !== undefined) columns.add(index);
    }
  }
  return [...columns].sort((left, right) => left - right);
}

export function parseWebsiteBuilderWorkflowRows(
  rows: readonly (readonly string[])[],
  sourceTab: string,
): WebsiteBuilderProject[] {
  const normalizedRows = rows.map((row) => row.map((value) => value ?? ""));
  const header = normalizedRows.find((row) => matchHeaderRow(row) !== null);
  const identities = header ? matchHeaderRow(header) : null;
  if (!identities) return [];

  const projects: WebsiteBuilderProject[] = [];
  let currentExecutive: string | null = null;

  normalizedRows.forEach((row, rowIndex) => {
    if (row === header) return;
    if (row.every((value) => !value.trim())) return;

    const rawExecutive = cell(row, identities.executive);
    if (rawExecutive && looksLikePlainName(rawExecutive)) currentExecutive = rawExecutive;

    const business = cell(row, identities.business);
    if (!business) return;

    const ob = cell(row, identities.ob);
    const webContent = cell(row, identities.webContent);
    const domain = cell(row, identities.domain);

    projects.push({
      id: `${sourceTab}::${rowIndex}`,
      sourceTab,
      sourceSection: currentExecutive ?? "Website Builder",
      executive: currentExecutive,
      orderNumber: cell(row, identities.orderNumber),
      business,
      businessUrl: findHttpUrl(business),
      dateOnboarded: cell(row, identities.dateOnboarded),
      ob,
      obUrl: findHttpUrl(ob),
      eta: cell(row, identities.eta),
      webContent,
      webContentUrl: findHttpUrl(webContent),
      domain,
      domainUrl: findLinkableUrl(domain),
      status: normalizeWebsiteBuilderStatus(cell(row, identities.status)),
      bottleneck: cell(row, identities.bottleneck),
      actions: cell(row, identities.actions),
    });
  });

  return projects;
}
