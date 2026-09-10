import "server-only";

import { z } from "zod";
import {
  applyCellHyperlinks,
  applyRecoveredStatusHeaders,
  locateAssignedVaColumns,
  locateBlankHeaderColumnsNeedingStatus,
  locateUrlColumns,
  looksLikeStatusValidationOptions,
} from "../../domain/operations/podcast-workflow";
import { readGoogleSheetsEnvironment, type GoogleSheetsEnvironment } from "../env/google-sheets-env";
import { currentCorrelationId } from "../security/request-correlation";
import { recordSecurityEvent } from "../security/security-log";
import {
  OperationsGoogleSheetsReadError,
  OperationsGoogleSheetsReader,
  type OperationsSheetTab,
} from "./operations-google-sheets";

/** The active reader owns token exchange and requests only https://www.googleapis.com/auth/spreadsheets.readonly. */
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/**
 * Next.js Data Cache tag for both Sheets reads below. The Podcast SEO sync
 * webhook calls `revalidateTag(PODCAST_SHEET_CACHE_TAG)` after a verified
 * change notification, which is the whole "event-driven invalidation, not
 * constant polling" mechanism — Google Sheets is otherwise only ever hit on
 * the existing 5-minute `revalidate` cadence or a genuine cache miss.
 */
export const PODCAST_SHEET_CACHE_TAG = "podcast-seo-sheet";

/**
 * Thrown for every "no live data available" case — missing configuration,
 * a failed token exchange, or a failed Sheets API call. Deliberately one
 * error type: the Operations UI only needs to distinguish "here are the
 * items" from "the source is unavailable," never *why* down to the wire
 * protocol, per the required "Podcast source unavailable" empty state.
 *
 * The `stage`/`httpStatus`/`apiErrorCode` fields exist only for the
 * temporary sanitized diagnostic log in the page's catch block — they carry
 * no credential or response-body data, just enough to tell the pipeline
 * stages apart in Preview logs.
 */
export type PodcastSheetsFailureStage =
  | "credential_validation"
  | "jwt_token"
  | "spreadsheet_metadata"
  | "tab_detection"
  | "sheet_values"
  | "parser"
  | "unknown";

export class PodcastSourceUnavailableError extends Error {
  readonly stage: PodcastSheetsFailureStage;
  readonly httpStatus?: number;
  readonly apiErrorCode?: string;

  constructor(
    message: string,
    options?: {
      cause?: unknown;
      stage?: PodcastSheetsFailureStage;
      httpStatus?: number;
      apiErrorCode?: string;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "PodcastSourceUnavailableError";
    this.stage = options?.stage ?? "unknown";
    this.httpStatus = options?.httpStatus;
    this.apiErrorCode = options?.apiErrorCode;
  }
}

/**
 * Extracts only a short machine error code (e.g. `PERMISSION_DENIED`,
 * `invalid_grant`) from a Google API error body — never the full body,
 * which may otherwise be logged verbatim by careless error handling.
 */
async function readApiErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const err = (body as Record<string, unknown>).error;
      if (typeof err === "string") return err;
      if (err && typeof err === "object") {
        const status = (err as Record<string, unknown>).status;
        const code = (err as Record<string, unknown>).code;
        if (typeof status === "string") return status;
        if (typeof code === "string" || typeof code === "number") return String(code);
      }
    }
  } catch {
    // Response body wasn't JSON or didn't match the expected error shape — no code to report.
  }
  return undefined;
}

/**
 * Structured diagnostic log for the Podcast SEO Sheets fetch — routed through
 * the platform's single sanctioned security logger (`recordSecurityEvent`),
 * never a raw `console.*` call, per this codebase's console-diagnostics
 * control. Records only the pipeline stage, the error's class name, and any
 * HTTP/API error code — never credential material, env values, the
 * spreadsheet id, a response body, or sheet/row contents. Call only from the
 * fetch's own catch path, never on the success path.
 */
export async function logPodcastSourceFetchFailure(error: unknown): Promise<void> {
  const stage: PodcastSheetsFailureStage =
    error instanceof PodcastSourceUnavailableError ? error.stage : "unknown";
  const httpStatus = error instanceof PodcastSourceUnavailableError ? error.httpStatus : undefined;
  const apiErrorCode = error instanceof PodcastSourceUnavailableError ? error.apiErrorCode : undefined;
  const errorName = error instanceof Error ? error.name : typeof error;

  recordSecurityEvent({
    event: "integration.podcast_sheets.fetch_failed",
    correlationId: await currentCorrelationId(),
    actorClass: "internal",
    provider: "google",
    resourceType: "podcast_seo_workflow",
    outcome: "failed",
    metadata: { stage, error_name: errorName, http_status: httpStatus, api_error_code: apiErrorCode },
  });
}

export type PodcastTabCandidate = {
  title: string;
  /** The tab's position in the workbook — only used as a last-resort tiebreak, never as the primary recency signal. */
  index: number;
};

const MONTH_NAME_TO_NUMBER: Readonly<Record<string, number>> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const YEAR_PATTERN = /\b(20\d{2})\b/;
const MONTH_NAME_PATTERN = new RegExp(
  `\\b(${Object.keys(MONTH_NAME_TO_NUMBER)
    .sort((a, b) => b.length - a.length)
    .join("|")})\\b`,
  "i",
);

type ParsedPodcastTabTitle = {
  title: string;
  index: number;
  /** `null` for legacy titles with no explicit year, e.g. "PODCAST DEPARTMENT (MAY)". */
  year: number | null;
  month: number | null;
};

function parsePodcastTabTitle(candidate: PodcastTabCandidate): ParsedPodcastTabTitle {
  const yearMatch = candidate.title.match(YEAR_PATTERN)?.[1];
  const monthKey = candidate.title.match(MONTH_NAME_PATTERN)?.[1]?.toLowerCase();
  return {
    title: candidate.title,
    index: candidate.index,
    year: yearMatch ? Number(yearMatch) : null,
    month: monthKey ? (MONTH_NAME_TO_NUMBER[monthKey] ?? null) : null,
  };
}

/**
 * Ascending recency comparator: a dated tab (explicit year, e.g. "AUGUST
 * 2026") always outranks an undated legacy tab (e.g. "(MAY)") regardless of
 * sheet position — a workbook reorder or a recreated legacy tab can
 * otherwise leave an old month sitting at a higher index than a genuinely
 * newer, dated one. Between two dated tabs, higher year then higher month
 * wins. Between two undated tabs, month names alone don't encode a year, so
 * the higher original sheet index (later in the workbook) is the only
 * freshness signal left, matching how such tabs have always been appended.
 */
function comparePodcastTabRecency(a: ParsedPodcastTabTitle, b: ParsedPodcastTabTitle): number {
  const aDated = a.year !== null;
  const bDated = b.year !== null;
  if (aDated !== bDated) return aDated ? 1 : -1;
  if (aDated) {
    if (a.year !== b.year) return (a.year as number) - (b.year as number);
    const aMonth = a.month ?? 0;
    const bMonth = b.month ?? 0;
    if (aMonth !== bMonth) return aMonth - bMonth;
  }
  return a.index - b.index;
}

/**
 * Picks the chronologically newest PODCAST-prefixed tab by the month/year
 * encoded in its title — not by array order, sheet index, or which title
 * happens to sort first/last lexicographically. Returns `null` when no tab
 * matches `tabTitlePrefix`.
 */
export function selectLatestPodcastTabTitle(
  candidates: readonly PodcastTabCandidate[],
  tabTitlePrefix = "PODCAST",
): string | null {
  const matching = candidates.filter((candidate) =>
    candidate.title.trim().toUpperCase().startsWith(tabTitlePrefix),
  );
  if (matching.length === 0) return null;
  const newest = matching.map(parsePodcastTabTitle).sort(comparePodcastTabRecency).at(-1);
  return newest ? newest.title : null;
}

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * Strict bare "MONTH YYYY" form — the *whole* (trimmed) title, nothing else,
 * e.g. "SEPTEMBER 2026". Deliberately anchored start-to-end: this is what
 * keeps it from also matching "PODCAST DEPARTMENT (MAY)" (extra words, no
 * year) or "Some Other Sheet" (no month/year at all), so it only ever widens
 * recognition to a tab that unambiguously names one specific month and year,
 * never to an arbitrary title.
 */
const BARE_MONTH_YEAR_PATTERN = new RegExp(
  `^(${Object.keys(MONTH_NAME_TO_NUMBER)
    .sort((a, b) => b.length - a.length)
    .join("|")})\\s+(20\\d{2})$`,
  "i",
);

function parseBareMonthYearTitle(candidate: PodcastTabCandidate): ParsedPodcastTabTitle | null {
  const match = candidate.title.trim().match(BARE_MONTH_YEAR_PATTERN);
  if (!match) return null;
  const month = MONTH_NAME_TO_NUMBER[match[1]!.toLowerCase()];
  if (!month) return null;
  return { title: candidate.title, index: candidate.index, year: Number(match[2]), month };
}

export type PodcastMonthOption = {
  /** "YYYY-MM" — the ?month= URL value and the only key the server accepts. */
  value: string;
  /** "August 2026" — display label. */
  label: string;
  /** The exact, already-verified workbook tab title this option resolves to. */
  tabTitle: string;
};

/**
 * The month selector's full option list — every tab whose title
 * unambiguously names a month and year, newest first. This is the
 * "server-discovered allowlist": every `value` in the returned list traces
 * back to a real tab title this function itself read from the workbook, so a
 * caller can never select an arbitrary sheet or range — only ever one of
 * these already-verified entries.
 *
 * Two independent, strict recognition rules — no broad/fuzzy matching of
 * arbitrary tab names:
 *
 * 1. Prefixed: starts with `tabTitlePrefix` (default "PODCAST") AND its
 *    title encodes both a year and a month, e.g. "PODCAST AUGUST 2026".
 * 2. Bare: the *entire* (trimmed) title is exactly "MONTH YYYY", e.g.
 *    "SEPTEMBER 2026" — the real dedicated Podcast workbook drops the
 *    "PODCAST" prefix on some monthly tabs, and this resolver only ever
 *    operates against that one dedicated workbook, so a strict bare
 *    MONTH YYYY form is a safe, unambiguous addition.
 *
 * Undated legacy tabs (e.g. "PODCAST DEPARTMENT (MAY)", which fails both
 * rules — prefixed but no year; not a bare month/year title either) and any
 * other unrelated tab (e.g. "Some Other Sheet") never become a selectable
 * option here — `selectLatestPodcastTabTitle` still covers undated legacy
 * tabs as the sole fallback path for a workbook with no dated tab at all.
 */
export function buildPodcastMonthOptions(
  candidates: readonly PodcastTabCandidate[],
  tabTitlePrefix = "PODCAST",
): PodcastMonthOption[] {
  const normalizedPrefix = tabTitlePrefix.trim().toUpperCase();
  const byValue = new Map<string, ParsedPodcastTabTitle>();
  for (const candidate of candidates) {
    const isPrefixed = candidate.title.trim().toUpperCase().startsWith(normalizedPrefix);
    const parsed = isPrefixed ? parsePodcastTabTitle(candidate) : parseBareMonthYearTitle(candidate);
    if (!parsed || parsed.year === null || parsed.month === null) continue;
    const value = `${parsed.year}-${String(parsed.month).padStart(2, "0")}`;
    const existing = byValue.get(value);
    // Two tabs could in principle encode the same month (a duplicate, a
    // renamed leftover, or a prefixed + bare tab both naming the same month)
    // — keep whichever one selectLatestPodcastTabTitle's own comparator
    // would itself pick, so the two never disagree.
    if (!existing || comparePodcastTabRecency(parsed, existing) > 0) byValue.set(value, parsed);
  }
  return [...byValue.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([value, parsed]) => ({
      value,
      label: `${MONTH_LABELS[parsed.month! - 1]} ${parsed.year}`,
      tabTitle: parsed.title,
    }));
}

/**
 * Resolves a caller-requested "YYYY-MM" value against the server-discovered
 * option list — an exact match, or the newest option (`options[0]`, since
 * the list is always newest-first) for a missing, malformed, or unrecognized
 * value. `null` only when the workbook has no dated Podcast tab at all.
 * There is deliberately no other outcome: a request can never select
 * anything the caller didn't itself already discover and offer.
 */
export function resolvePodcastMonthSelection(
  options: readonly PodcastMonthOption[],
  requestedValue: string | null,
): PodcastMonthOption | null {
  if (options.length === 0) return null;
  const requested = requestedValue ? options.find((option) => option.value === requestedValue) : undefined;
  return requested ?? options[0]!;
}

export type PodcastWorkflowSheet = {
  /** The sheet tab's own title, e.g. "PODCAST AUGUST 2026" — becomes `sourceMonth`. */
  sourceMonth: string;
  rows: string[][];
  /**
   * Every value the Assigned VA column(s)' own Sheets data-validation
   * dropdown allows — read-only, via `spreadsheets.get`, never
   * `spreadsheets.values.update` or `batchUpdate`. Optional so a fake test
   * source can omit it; `GoogleSheetsPodcastWorkflowSource` always populates
   * it (defaulting to `[]` on any failure — a validation-read hiccup must
   * never take down the whole snapshot).
   */
  assignedVaValidationOptions?: string[];
};

export interface PodcastWorkflowSource {
  fetchLatestPodcastTab(): Promise<PodcastWorkflowSheet>;
  /** The month selector's server-discovered allowlist — see `buildPodcastMonthOptions`. */
  listAvailablePodcastMonths(): Promise<PodcastMonthOption[]>;
  /**
   * Fetches one already-discovered tab by its exact title — never a
   * caller-supplied arbitrary string. Every real call site passes a
   * `tabTitle` taken directly from `listAvailablePodcastMonths()`'s own
   * output or from `selectLatestPodcastTabTitle`, both of which only ever
   * return a title this same source itself read from the live workbook.
   */
  fetchPodcastTab(tabTitle: string): Promise<PodcastWorkflowSheet>;
}

const spreadsheetMetadataSchema = z.object({
  sheets: z.array(z.object({
    properties: z.object({
      title: z.string(),
      index: z.number().int().nonnegative(),
    }),
  })),
});

const valuesResponseSchema = z.object({
  values: z.array(z.array(z.string())).optional(),
});

/**
 * Deliberately optional at every level: a `spreadsheets.get` response over a
 * mostly-empty range omits whole branches rather than sending empty arrays,
 * and this must still parse rather than throw (a validation-read failure
 * falls back to an empty option list, never to "source unavailable").
 */
const dataValidationGridSchema = z.object({
  sheets: z
    .array(
      z.object({
        data: z
          .array(
            z.object({
              rowData: z
                .array(
                  z.object({
                    values: z
                      .array(
                        z.object({
                          dataValidation: z
                            .object({
                              condition: z
                                .object({
                                  type: z.string().optional(),
                                  values: z
                                    .array(z.object({ userEnteredValue: z.string().optional() }))
                                    .optional(),
                                })
                                .optional(),
                            })
                            .optional(),
                        }),
                      )
                      .optional(),
                  }),
                )
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

/**
 * Google Sheets, read via a service account (Viewer access granted on the
 * sheet itself, not a per-user OAuth consent) — the right shape for
 * unattended internal reads of one shared operational workbook. Server-only:
 * the access token and signing key never reach browser JavaScript.
 */
export class GoogleSheetsPodcastWorkflowSource implements PodcastWorkflowSource {
  private readonly reader: OperationsGoogleSheetsReader;

  constructor(
    private readonly environment: GoogleSheetsEnvironment,
    private readonly fetcher: typeof fetch = fetch,
    /** Only tabs whose title starts with this (case-insensitive) are candidates for "latest." */
    private readonly tabTitlePrefix = "PODCAST",
  ) {
    this.reader = new OperationsGoogleSheetsReader(environment, PODCAST_SHEET_CACHE_TAG, fetcher);
  }

  async fetchLatestPodcastTab(): Promise<PodcastWorkflowSheet> {
    const tabs = await this.listTabsOrThrow();
    const sourceMonth = selectLatestPodcastTabTitle(tabs, this.tabTitlePrefix);
    if (!sourceMonth) {
      throw new PodcastSourceUnavailableError("No Podcast SEO tab was found in the workbook.", {
        stage: "tab_detection",
      });
    }
    return this.fetchPodcastTab(sourceMonth);
  }

  async listAvailablePodcastMonths(): Promise<PodcastMonthOption[]> {
    const tabs = await this.listTabsOrThrow();
    return buildPodcastMonthOptions(tabs, this.tabTitlePrefix);
  }

  /**
   * Fetches rows, recovers any block's Status column that a real-world sheet
   * left with a genuinely blank header cell (see `applyRecoveredStatusHeaders`
   * — driven by the sheet's own data-validation vocabulary, never a
   * hardcoded row/column/client), resolves every URL-bearing cell's real
   * hyperlink target (see `applyCellHyperlinks`), and reads the Assigned VA
   * dropdown options — the same reads `fetchLatestPodcastTab` always
   * performed, now shared by both the "latest" path and an explicit month
   * selection so the two can never drift into fetching a different shape of
   * data.
   */
  async fetchPodcastTab(tabTitle: string): Promise<PodcastWorkflowSheet> {
    try {
      const rawRows = await this.reader.readTabValues(this.environment.PODCAST_SEO_SPREADSHEET_ID, tabTitle);

      const statusCandidateColumns = locateBlankHeaderColumnsNeedingStatus(rawRows);
      let statusColumns = new Set<number>();
      if (statusCandidateColumns.length > 0) {
        const optionSets = await this.reader.readColumnValidationOptionSets(
          this.environment.PODCAST_SEO_SPREADSHEET_ID,
          tabTitle,
          statusCandidateColumns,
        );
        statusColumns = new Set(
          [...optionSets.entries()]
            .filter(([, options]) => looksLikeStatusValidationOptions(options))
            .map(([columnIndex]) => columnIndex),
        );
      }
      const rowsWithRecoveredStatusHeaders = applyRecoveredStatusHeaders(rawRows, statusColumns);

      const urlColumns = locateUrlColumns(rowsWithRecoveredStatusHeaders);
      const hyperlinks =
        urlColumns.length > 0
          ? await this.reader.readCellHyperlinks(
              this.environment.PODCAST_SEO_SPREADSHEET_ID,
              tabTitle,
              urlColumns,
              rowsWithRecoveredStatusHeaders.length,
            )
          : new Map<string, string>();
      const rows = applyCellHyperlinks(rowsWithRecoveredStatusHeaders, hyperlinks);
      const assignedVaValidationOptions = await this.reader.readListValidationOptions(
        this.environment.PODCAST_SEO_SPREADSHEET_ID,
        tabTitle,
        locateAssignedVaColumns(rows),
      );
      return { sourceMonth: tabTitle, rows, assignedVaValidationOptions };
    } catch (error) {
      if (error instanceof PodcastSourceUnavailableError) throw error;
      if (error instanceof OperationsGoogleSheetsReadError) {
        throw new PodcastSourceUnavailableError(error.message, {
          cause: error,
          stage: error.stage,
          httpStatus: error.httpStatus,
          apiErrorCode: error.apiErrorCode,
        });
      }
      throw error;
    }
  }

  private async listTabsOrThrow(): Promise<OperationsSheetTab[]> {
    try {
      return await this.reader.listTabs(this.environment.PODCAST_SEO_SPREADSHEET_ID);
    } catch (error) {
      if (error instanceof OperationsGoogleSheetsReadError) {
        throw new PodcastSourceUnavailableError(error.message, {
          cause: error,
          stage: error.stage,
          httpStatus: error.httpStatus,
          apiErrorCode: error.apiErrorCode,
        });
      }
      throw error;
    }
  }

  /**
   * The workbook grows a new tab per month rather than exposing a fixed
   * "current" range, so the latest tab is resolved dynamically instead of
   * being hardcoded to one month's title — by the month/year encoded in
   * each candidate title (`selectLatestPodcastTabTitle`), not by sheet
   * position, since a legacy undated tab can otherwise sit at a higher
   * index than a genuinely newer, dated one.
   */
  private async resolveLatestPodcastTabTitle(accessToken: string): Promise<string> {
    const url = `${SHEETS_API_BASE}/${encodeURIComponent(this.environment.PODCAST_SEO_SPREADSHEET_ID)}?fields=sheets.properties(title,index)`;
    const response = await this.fetcher(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      next: { revalidate: 300, tags: [PODCAST_SHEET_CACHE_TAG] },
    });
    if (!response.ok) {
      throw new PodcastSourceUnavailableError("Could not read the Podcast SEO workbook's tab list.", {
        stage: "spreadsheet_metadata",
        httpStatus: response.status,
        apiErrorCode: await readApiErrorCode(response),
      });
    }
    let metadata: z.infer<typeof spreadsheetMetadataSchema>;
    try {
      metadata = spreadsheetMetadataSchema.parse(await response.json());
    } catch (error) {
      throw new PodcastSourceUnavailableError("Podcast SEO workbook metadata did not match the expected shape.", {
        cause: error,
        stage: "spreadsheet_metadata",
        httpStatus: response.status,
      });
    }
    const latestTitle = selectLatestPodcastTabTitle(
      metadata.sheets.map((sheet) => ({ title: sheet.properties.title, index: sheet.properties.index })),
      this.tabTitlePrefix,
    );
    if (!latestTitle) {
      throw new PodcastSourceUnavailableError("No Podcast SEO tab was found in the workbook.", {
        stage: "tab_detection",
      });
    }
    return latestTitle;
  }

  private async fetchTabValues(accessToken: string, tabTitle: string): Promise<string[][]> {
    const range = `'${tabTitle.replace(/'/g, "''")}'`;
    const url = `${SHEETS_API_BASE}/${encodeURIComponent(this.environment.PODCAST_SEO_SPREADSHEET_ID)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
    const response = await this.fetcher(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      next: { revalidate: 300, tags: [PODCAST_SHEET_CACHE_TAG] },
    });
    if (!response.ok) {
      throw new PodcastSourceUnavailableError("Could not read the Podcast SEO tab's data.", {
        stage: "sheet_values",
        httpStatus: response.status,
        apiErrorCode: await readApiErrorCode(response),
      });
    }
    let parsed: z.infer<typeof valuesResponseSchema>;
    try {
      parsed = valuesResponseSchema.parse(await response.json());
    } catch (error) {
      throw new PodcastSourceUnavailableError("Podcast SEO tab data did not match the expected shape.", {
        cause: error,
        stage: "sheet_values",
        httpStatus: response.status,
      });
    }
    return parsed.values ?? [];
  }

  /**
   * The Assigned VA column(s)' own Sheets data-validation dropdown values —
   * read via `spreadsheets.get` with a `dataValidation`-only field mask over
   * a generous fixed-height range per column, never `values.update` or
   * `batchUpdate`. Scanning the whole column height (not just currently
   * populated rows) is what surfaces a valid VA option that has zero work
   * items right now: Sheets applies one validation rule across an entire
   * column range regardless of which cells in it currently hold a value, but
   * `values.get` only ever returns rows up to the last populated one, so an
   * empty cell further down would otherwise never be inspected.
   *
   * Never throws: a malformed response, a non-OK status, or any other
   * failure here falls back to an empty list rather than surfacing as
   * "Podcast source unavailable" — the Assigned VA filter simply falls back
   * to whatever values are already present in parsed records.
   */
  private async fetchAssignedVaValidationOptions(
    accessToken: string,
    tabTitle: string,
    rows: readonly string[][],
  ): Promise<string[]> {
    try {
      const columns = locateAssignedVaColumns(rows);
      if (columns.length === 0) return [];

      const escapedTitle = tabTitle.replace(/'/g, "''");
      const params = new URLSearchParams();
      for (const columnIndex of columns) {
        const columnLetter = columnIndexToLetter(columnIndex);
        params.append("ranges", `'${escapedTitle}'!${columnLetter}1:${columnLetter}${VALIDATION_SCAN_ROW_COUNT}`);
      }
      params.set("fields", "sheets.data.rowData.values.dataValidation");

      const url = `${SHEETS_API_BASE}/${encodeURIComponent(this.environment.PODCAST_SEO_SPREADSHEET_ID)}?${params.toString()}`;
      const response = await this.fetcher(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        next: { revalidate: 300, tags: [PODCAST_SHEET_CACHE_TAG] },
      });
      if (!response.ok) return [];

      const parsed = dataValidationGridSchema.parse(await response.json());
      const values = new Set<string>();
      for (const sheet of parsed.sheets ?? []) {
        for (const data of sheet.data ?? []) {
          for (const rowData of data.rowData ?? []) {
            for (const cell of rowData.values ?? []) {
              const condition = cell.dataValidation?.condition;
              if (condition?.type !== "ONE_OF_LIST") continue;
              for (const entry of condition.values ?? []) {
                if (entry.userEnteredValue) values.add(entry.userEnteredValue);
              }
            }
          }
        }
      }
      return [...values];
    } catch {
      return [];
    }
  }
}

/** How far down each Assigned VA column to scan for its data-validation rule — generous enough to include rows with no data yet. */
const VALIDATION_SCAN_ROW_COUNT = 2000;

/** 0 -> "A", 25 -> "Z", 26 -> "AA" — spreadsheet column letters are base-26 with no zero digit. */
function columnIndexToLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

/**
 * Returns a source only when the required service-account configuration is
 * present — never a stub or fixture data. Callers get a
 * `PodcastSourceUnavailableError` immediately, before any network call, when
 * `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY`,
 * or `PODCAST_SEO_SPREADSHEET_ID` is missing from the server environment.
 */
export function createPodcastWorkflowSource(): PodcastWorkflowSource {
  let environment: GoogleSheetsEnvironment;
  try {
    environment = readGoogleSheetsEnvironment();
  } catch (error) {
    throw new PodcastSourceUnavailableError(
      "The Podcast SEO Google Sheets connection is not configured on this server.",
      { cause: error, stage: "credential_validation" },
    );
  }
  return new GoogleSheetsPodcastWorkflowSource(environment);
}
