import "server-only";

import { createSign } from "node:crypto";
import { z } from "zod";
import type { GoogleSheetsServiceAccountEnvironment } from "../env/google-sheets-env";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export type OperationsSheetFailureStage =
  | "jwt_token"
  | "spreadsheet_metadata"
  | "sheet_values";

export class OperationsGoogleSheetsReadError extends Error {
  readonly stage: OperationsSheetFailureStage;
  readonly httpStatus?: number;
  readonly apiErrorCode?: string;

  constructor(
    message: string,
    options: {
      stage: OperationsSheetFailureStage;
      cause?: unknown;
      httpStatus?: number;
      apiErrorCode?: string;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "OperationsGoogleSheetsReadError";
    this.stage = options.stage;
    this.httpStatus = options.httpStatus;
    this.apiErrorCode = options.apiErrorCode;
  }
}

export type OperationsSheetTab = {
  title: string;
  index: number;
};

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
});

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

const dataValidationGridSchema = z.object({
  sheets: z.array(z.object({
    data: z.array(z.object({
      rowData: z.array(z.object({
        values: z.array(z.object({
          dataValidation: z.object({
            condition: z.object({
              type: z.string().optional(),
              values: z.array(z.object({ userEnteredValue: z.string().optional() })).optional(),
            }).optional(),
          }).optional(),
        })).optional(),
      })).optional(),
    })).optional(),
  })).optional(),
});

const columnValidationGridSchema = z.object({
  sheets: z.array(z.object({
    data: z.array(z.object({
      startColumn: z.number().int().nonnegative().optional(),
      rowData: z.array(z.object({
        values: z.array(z.object({
          dataValidation: z.object({
            condition: z.object({
              type: z.string().optional(),
              values: z.array(z.object({ userEnteredValue: z.string().optional() })).optional(),
            }).optional(),
          }).optional(),
        })).optional(),
      })).optional(),
    })).optional(),
  })).optional(),
});

/**
 * A Google Docs/Drive "smart chip" cell (Insert > Smart chips > File) carries
 * no `CellData.hyperlink` at all — its target lives under
 * `chipRuns[].chip.richLinkProperties.uri` instead. Proven against the real
 * September 2026 workbook: a `spreadsheets.get` read with
 * `fields=...rowData.values(hyperlink,chipRuns)` over a live chip cell
 * returned no `hyperlink` key and exactly this `chipRuns` shape. `chipRuns`
 * is an array because Sheets supports multiple chips at different character
 * offsets within one rich-text cell (each entry carries its own
 * `startIndex`, immaterial here since only the link target is read); every
 * real Docs/file chip observed in this workbook is one chip spanning the
 * whole cell.
 */
const hyperlinkGridSchema = z.object({
  sheets: z.array(z.object({
    data: z.array(z.object({
      startRow: z.number().int().nonnegative().optional(),
      startColumn: z.number().int().nonnegative().optional(),
      rowData: z.array(z.object({
        values: z.array(z.object({
          hyperlink: z.string().optional(),
          chipRuns: z.array(z.object({
            chip: z.object({
              richLinkProperties: z.object({
                uri: z.string().optional(),
              }).optional(),
            }).optional(),
          })).optional(),
        })).optional(),
      })).optional(),
    })).optional(),
  })).optional(),
});

/**
 * The real, stored link target for one cell — never a guess from the
 * displayed text. Deterministic priority, in order:
 *
 * 1. `CellData.hyperlink` — an explicit rich-text link or a resolved
 *    `=HYPERLINK(url, label)` formula. Checked first to preserve every
 *    existing raw-URL and ordinary-hyperlink behavior exactly as before this
 *    change; a cell can't carry both `hyperlink` and `chipRuns` in practice
 *    (they're two different Sheets link mechanisms), so this ordering never
 *    silently discards a chip URI in favor of a hyperlink from the same
 *    cell — it only ever matters when exactly one of the two is present.
 * 2. `chipRuns[0].chip.richLinkProperties.uri` — a Google Docs/Drive smart
 *    chip's own stored target. The first chip run wins: every real chip
 *    observed in this workbook is one run spanning the whole cell, so "first"
 *    and "only" coincide in practice; a hypothetical cell with several chips
 *    at different offsets still resolves deterministically rather than
 *    ambiguously.
 *
 * Returns `undefined` (never a fabricated string) when neither
 * representation carries a real URI — a chip's visible title or a plain
 * label is not a link and must never become one.
 */
function extractCellLinkUri(cell: {
  hyperlink?: string;
  chipRuns?: { chip?: { richLinkProperties?: { uri?: string } } }[];
}): string | undefined {
  if (cell.hyperlink) return cell.hyperlink;
  for (const chipRun of cell.chipRuns ?? []) {
    const uri = chipRun.chip?.richLinkProperties?.uri;
    if (uri) return uri;
  }
  return undefined;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signServiceAccountJwt(environment: GoogleSheetsServiceAccountEnvironment): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims = base64UrlEncode(JSON.stringify({
    iss: environment.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL,
    scope: READONLY_SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const privateKey = environment.GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n");
  const signature = base64UrlEncode(createSign("RSA-SHA256").update(signingInput).sign(privateKey));
  return `${signingInput}.${signature}`;
}

/**
 * Bounded backoff for Google's `RESOURCE_EXHAUSTED` (HTTP 429) quota
 * response. A fresh `OperationsGoogleSheetsReader` is constructed per
 * request, but the Sheets API quota it draws against is shared across every
 * request hitting the same spreadsheet in this server process — so the
 * cooldown lives at module scope, keyed by spreadsheet id, rather than on
 * the reader instance. One 429 marks that spreadsheet "cooling down" for
 * `RATE_LIMIT_COOLDOWN_MS`; every read method below fails fast (no outbound
 * call at all, real or cached) for the rest of that window instead of
 * immediately retrying into a quota that is already exhausted — this is
 * what keeps one rate-limit response from becoming a request storm.
 */
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const rateLimitCooldownUntil = new Map<string, number>();

function isRateLimitResponse(httpStatus: number, apiErrorCode: string | undefined): boolean {
  return httpStatus === 429 || apiErrorCode === "RESOURCE_EXHAUSTED";
}

function isCoolingDownFromRateLimit(spreadsheetId: string): boolean {
  const until = rateLimitCooldownUntil.get(spreadsheetId);
  return until !== undefined && Date.now() < until;
}

function recordRateLimitCooldown(spreadsheetId: string): void {
  rateLimitCooldownUntil.set(spreadsheetId, Date.now() + RATE_LIMIT_COOLDOWN_MS);
}

async function readApiErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return undefined;
    const error = (body as Record<string, unknown>).error;
    if (typeof error === "string") return error;
    if (!error || typeof error !== "object") return undefined;
    const status = (error as Record<string, unknown>).status;
    const code = (error as Record<string, unknown>).code;
    if (typeof status === "string") return status;
    if (typeof code === "string" || typeof code === "number") return String(code);
  } catch {
    // Google returned no safe, machine-readable error code.
  }
  return undefined;
}

/**
 * Shared, server-only Google Sheets reader for Operations departments.
 * It owns service-account JWT exchange and the two safe read primitives
 * every workflow needs: listing tabs and reading one tab's values. Department
 * selection and row parsing deliberately remain outside this adapter.
 */
export class OperationsGoogleSheetsReader {
  private accessTokenPromise: Promise<string> | null = null;

  constructor(
    private readonly environment: GoogleSheetsServiceAccountEnvironment,
    private readonly cacheTag: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async listTabs(spreadsheetId: string): Promise<OperationsSheetTab[]> {
    if (isCoolingDownFromRateLimit(spreadsheetId)) {
      throw new OperationsGoogleSheetsReadError("Google Sheets API quota cooldown is active.", {
        stage: "spreadsheet_metadata",
        httpStatus: 429,
        apiErrorCode: "RESOURCE_EXHAUSTED",
      });
    }
    const accessToken = await this.fetchAccessToken();
    const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(title,index)`;
    const response = await this.fetcher(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "force-cache",
      next: { revalidate: 300, tags: [this.cacheTag] },
    });
    if (!response.ok) {
      const apiErrorCode = await readApiErrorCode(response);
      if (isRateLimitResponse(response.status, apiErrorCode)) recordRateLimitCooldown(spreadsheetId);
      throw new OperationsGoogleSheetsReadError("Could not read workbook metadata.", {
        stage: "spreadsheet_metadata",
        httpStatus: response.status,
        apiErrorCode,
      });
    }

    try {
      const metadata = spreadsheetMetadataSchema.parse(await response.json());
      return metadata.sheets.map((sheet) => sheet.properties);
    } catch (error) {
      throw new OperationsGoogleSheetsReadError("Workbook metadata had an unexpected shape.", {
        stage: "spreadsheet_metadata",
        cause: error,
        httpStatus: response.status,
      });
    }
  }

  async readTabValues(spreadsheetId: string, tabTitle: string): Promise<string[][]> {
    if (isCoolingDownFromRateLimit(spreadsheetId)) {
      throw new OperationsGoogleSheetsReadError("Google Sheets API quota cooldown is active.", {
        stage: "sheet_values",
        httpStatus: 429,
        apiErrorCode: "RESOURCE_EXHAUSTED",
      });
    }
    const accessToken = await this.fetchAccessToken();
    const range = `'${tabTitle.replace(/'/g, "''")}'`;
    const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
    const response = await this.fetcher(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "force-cache",
      next: { revalidate: 300, tags: [this.cacheTag] },
    });
    if (!response.ok) {
      const apiErrorCode = await readApiErrorCode(response);
      if (isRateLimitResponse(response.status, apiErrorCode)) recordRateLimitCooldown(spreadsheetId);
      throw new OperationsGoogleSheetsReadError("Could not read workflow rows.", {
        stage: "sheet_values",
        httpStatus: response.status,
        apiErrorCode,
      });
    }

    try {
      const parsed = valuesResponseSchema.parse(await response.json());
      return parsed.values ?? [];
    } catch (error) {
      throw new OperationsGoogleSheetsReadError("Workflow rows had an unexpected shape.", {
        stage: "sheet_values",
        cause: error,
        httpStatus: response.status,
      });
    }
  }

  /**
   * Optional read-only helper for filters backed by a Sheet dropdown. A
   * validation-read failure returns no options instead of taking down the
   * workflow snapshot; populated row values can still supply fallbacks.
   */
  async readListValidationOptions(
    spreadsheetId: string,
    tabTitle: string,
    columnIndices: readonly number[],
  ): Promise<string[]> {
    if (columnIndices.length === 0) return [];
    if (isCoolingDownFromRateLimit(spreadsheetId)) return [];
    try {
      const accessToken = await this.fetchAccessToken();
      const escapedTitle = tabTitle.replace(/'/g, "''");
      const params = new URLSearchParams();
      for (const columnIndex of columnIndices) {
        const columnLetter = columnIndexToLetter(columnIndex);
        params.append("ranges", `'${escapedTitle}'!${columnLetter}1:${columnLetter}2000`);
      }
      params.set("fields", "sheets.data.rowData.values.dataValidation");

      const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?${params.toString()}`;
      const response = await this.fetcher(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "force-cache",
        next: { revalidate: 300, tags: [this.cacheTag] },
      });
      if (!response.ok) {
        if (isRateLimitResponse(response.status, await readApiErrorCode(response))) {
          recordRateLimitCooldown(spreadsheetId);
        }
        return [];
      }

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

  /**
   * Every ONE_OF_LIST data-validation rule's own option values, keyed by
   * column index — a generic, meaning-agnostic read: this method has no idea
   * what any column represents or what its options mean. Callers (e.g. the
   * Podcast source's Status-column recovery) decide what a given column's
   * option set implies; this only ever reports what the sheet itself
   * declares. Never throws: a malformed response, a non-OK status, or any
   * other failure here returns an empty map rather than failing the whole
   * tab fetch, matching `readListValidationOptions`'s existing fail-open
   * shape for this same class of optional, best-effort read.
   */
  async readColumnValidationOptionSets(
    spreadsheetId: string,
    tabTitle: string,
    columnIndices: readonly number[],
  ): Promise<Map<number, string[]>> {
    const result = new Map<number, string[]>();
    if (columnIndices.length === 0) return result;
    if (isCoolingDownFromRateLimit(spreadsheetId)) return result;
    try {
      const accessToken = await this.fetchAccessToken();
      const escapedTitle = tabTitle.replace(/'/g, "''");
      const params = new URLSearchParams();
      for (const columnIndex of columnIndices) {
        const columnLetter = columnIndexToLetter(columnIndex);
        params.append("ranges", `'${escapedTitle}'!${columnLetter}1:${columnLetter}2000`);
      }
      params.set("fields", "sheets.data(startColumn,rowData.values.dataValidation)");

      const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?${params.toString()}`;
      const response = await this.fetcher(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "force-cache",
        next: { revalidate: 300, tags: [this.cacheTag] },
      });
      if (!response.ok) {
        if (isRateLimitResponse(response.status, await readApiErrorCode(response))) {
          recordRateLimitCooldown(spreadsheetId);
        }
        return result;
      }

      const parsed = columnValidationGridSchema.parse(await response.json());
      for (const sheet of parsed.sheets ?? []) {
        for (const data of sheet.data ?? []) {
          const columnIndex = data.startColumn ?? 0;
          const values = new Set<string>();
          for (const rowData of data.rowData ?? []) {
            for (const cell of rowData.values ?? []) {
              const condition = cell.dataValidation?.condition;
              if (condition?.type !== "ONE_OF_LIST") continue;
              for (const entry of condition.values ?? []) {
                if (entry.userEnteredValue) values.add(entry.userEnteredValue);
              }
            }
          }
          if (values.size > 0) result.set(columnIndex, [...values]);
        }
      }
      return result;
    } catch {
      return result;
    }
  }

  /**
   * The real link target behind each cell in the given columns, keyed
   * `"<0-based row index>,<0-based column index>"` matching the same indices
   * `values.get` (`readTabValues`) returns rows/cells at — so a caller can
   * overlay this directly onto that grid. `values.get` alone only ever
   * returns a cell's plain display text, which is the exact inconsistency
   * this exists to close for every Sheets link representation `values.get`
   * can't distinguish: an explicit rich-text link or resolved
   * `=HYPERLINK(url, label)` formula (`CellData.hyperlink`), and a Google
   * Docs/Drive smart chip (`CellData.chipRuns[].chip.richLinkProperties.uri`
   * — proven against the real September 2026 workbook; see
   * `extractCellLinkUri`'s doc comment for the priority between the two).
   * Scoped to `rowCount` (the caller's own already-fetched row count), not a
   * generous fixed height like the validation scan — a link has no meaning
   * on a row that carries no data at all, and every column/range here comes
   * from `locateUrlColumns`'s server-side header discovery, never a caller-
   * supplied sheet name or range. Never throws: a read failure here falls
   * back to the plain display text everywhere, which is the existing
   * (imperfect but safe) behavior, never a broken or blank workflow. Never
   * synthesizes a link from a cell's displayed text — only ever surfaces a
   * URI the Sheets API itself reports as that cell's stored link target.
   */
  async readCellHyperlinks(
    spreadsheetId: string,
    tabTitle: string,
    columnIndices: readonly number[],
    rowCount: number,
  ): Promise<Map<string, string>> {
    const hyperlinks = new Map<string, string>();
    if (columnIndices.length === 0 || rowCount <= 0) return hyperlinks;
    if (isCoolingDownFromRateLimit(spreadsheetId)) return hyperlinks;
    try {
      const accessToken = await this.fetchAccessToken();
      const escapedTitle = tabTitle.replace(/'/g, "''");
      const params = new URLSearchParams();
      for (const columnIndex of columnIndices) {
        const columnLetter = columnIndexToLetter(columnIndex);
        params.append("ranges", `'${escapedTitle}'!${columnLetter}1:${columnLetter}${rowCount}`);
      }
      params.set("fields", "sheets.data(startRow,startColumn,rowData.values(hyperlink,chipRuns))");

      const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?${params.toString()}`;
      const response = await this.fetcher(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "force-cache",
        next: { revalidate: 300, tags: [this.cacheTag] },
      });
      if (!response.ok) {
        if (isRateLimitResponse(response.status, await readApiErrorCode(response))) {
          recordRateLimitCooldown(spreadsheetId);
        }
        return hyperlinks;
      }

      const parsed = hyperlinkGridSchema.parse(await response.json());
      for (const sheet of parsed.sheets ?? []) {
        for (const data of sheet.data ?? []) {
          const baseRow = data.startRow ?? 0;
          const baseColumn = data.startColumn ?? 0;
          (data.rowData ?? []).forEach((rowData, rowOffset) => {
            (rowData.values ?? []).forEach((cell, columnOffset) => {
              const uri = extractCellLinkUri(cell);
              if (uri) hyperlinks.set(`${baseRow + rowOffset},${baseColumn + columnOffset}`, uri);
            });
          });
        }
      }
      return hyperlinks;
    } catch {
      return hyperlinks;
    }
  }

  private async fetchAccessToken(): Promise<string> {
    this.accessTokenPromise ??= this.exchangeAccessToken();
    return this.accessTokenPromise;
  }

  private async exchangeAccessToken(): Promise<string> {
    let assertion: string;
    try {
      assertion = signServiceAccountJwt(this.environment);
    } catch (error) {
      throw new OperationsGoogleSheetsReadError("Google service-account JWT could not be created.", {
        stage: "jwt_token",
        cause: error,
      });
    }

    const response = await this.fetcher(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new OperationsGoogleSheetsReadError("Google service-account authorization failed.", {
        stage: "jwt_token",
        httpStatus: response.status,
        apiErrorCode: await readApiErrorCode(response),
      });
    }

    try {
      return tokenResponseSchema.parse(await response.json()).access_token;
    } catch (error) {
      throw new OperationsGoogleSheetsReadError("Google token response had an unexpected shape.", {
        stage: "jwt_token",
        cause: error,
        httpStatus: response.status,
      });
    }
  }
}

function columnIndexToLetter(index: number): string {
  let value = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return letters;
}

const MONTHS: Readonly<Record<string, number>> = {
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
const MONTH_PATTERN = new RegExp(`\\b(${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|")})\\b`, "i");
const YEAR_PATTERN = /\b(20\d{2})\b/;
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function tabRecency(tab: OperationsSheetTab): readonly [number, number, number, number] {
  const year = Number(tab.title.match(YEAR_PATTERN)?.[1] ?? 0);
  const monthKey = tab.title.match(MONTH_PATTERN)?.[1]?.toLowerCase();
  const month = monthKey ? (MONTHS[monthKey] ?? 0) : 0;
  return [year > 0 ? 1 : 0, year, month, tab.index];
}

/**
 * Selects the newest monthly tab without hard-coding a month name. If the
 * workbook contains Content-prefixed tabs, unrelated helper tabs are ignored;
 * otherwise a Content-only workbook can use month-only tab names and the
 * latest dated/indexed tab still wins.
 */
export function selectLatestOperationsWorkflowTab(
  tabs: readonly OperationsSheetTab[],
  preferredPrefix: string,
): string | null {
  if (tabs.length === 0) return null;
  const preferred = tabs.filter((tab) =>
    tab.title.trim().toLowerCase().startsWith(preferredPrefix.trim().toLowerCase()),
  );
  const monthly = tabs.filter((tab) => {
    const rank = tabRecency(tab);
    return rank[1] > 0 && rank[2] > 0;
  });
  // A workbook may keep a prefixed template/helper tab beside month-only
  // workflow tabs. Explicit month+year titles are the strongest freshness
  // evidence regardless of prefix; prefix is the fallback for legacy tabs.
  const candidates = monthly.length > 0 ? monthly : preferred.length > 0 ? preferred : tabs;
  const sorted = [...candidates].sort((a, b) => {
    const aRank = tabRecency(a);
    const bRank = tabRecency(b);
    for (let index = 0; index < aRank.length; index += 1) {
      const difference = aRank[index]! - bRank[index]!;
      if (difference !== 0) return difference;
    }
    return 0;
  });
  return sorted.at(-1)?.title ?? null;
}

export type OperationsWorkflowMonthOption = {
  value: string;
  label: string;
  tabTitle: string;
};

/**
 * Builds a newest-first, server-discovered month allowlist for a department.
 * Matching is case/spacing tolerant, but remains scoped to the requested
 * prefix and requires an explicit month plus four-digit year. Duplicate month
 * tabs resolve to the later workbook index, matching latest-tab selection.
 */
export function buildOperationsWorkflowMonthOptions(
  tabs: readonly OperationsSheetTab[],
  preferredPrefix: string,
): OperationsWorkflowMonthOption[] {
  const normalizedPrefix = preferredPrefix.trim().toLowerCase().replace(/\s+/g, "");
  const byValue = new Map<string, { tab: OperationsSheetTab; month: number; year: number }>();
  for (const tab of tabs) {
    const normalizedTitle = tab.title.trim().toLowerCase().replace(/\s+/g, "");
    if (!normalizedTitle.startsWith(normalizedPrefix)) continue;
    const year = Number(tab.title.match(YEAR_PATTERN)?.[1] ?? 0);
    const monthKey = tab.title.match(MONTH_PATTERN)?.[1]?.toLowerCase();
    const month = monthKey ? (MONTHS[monthKey] ?? 0) : 0;
    if (!year || !month) continue;
    const value = `${year}-${String(month).padStart(2, "0")}`;
    const existing = byValue.get(value);
    if (!existing || tab.index > existing.tab.index) byValue.set(value, { tab, month, year });
  }
  return [...byValue.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([value, entry]) => ({
      value,
      label: `${MONTH_LABELS[entry.month - 1]} ${entry.year}`,
      tabTitle: entry.tab.title,
    }));
}

export function resolveOperationsWorkflowMonthSelection(
  options: readonly OperationsWorkflowMonthOption[],
  requestedValue: string | null,
): OperationsWorkflowMonthOption | null {
  if (options.length === 0) return null;
  return options.find((option) => option.value === requestedValue) ?? options[0]!;
}
