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

const hyperlinkGridSchema = z.object({
  sheets: z.array(z.object({
    data: z.array(z.object({
      startRow: z.number().int().nonnegative().optional(),
      startColumn: z.number().int().nonnegative().optional(),
      rowData: z.array(z.object({
        values: z.array(z.object({
          hyperlink: z.string().optional(),
        })).optional(),
      })).optional(),
    })).optional(),
  })).optional(),
});

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
    const accessToken = await this.fetchAccessToken();
    const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(title,index)`;
    const response = await this.fetcher(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      next: { revalidate: 300, tags: [this.cacheTag] },
    });
    if (!response.ok) {
      throw new OperationsGoogleSheetsReadError("Could not read workbook metadata.", {
        stage: "spreadsheet_metadata",
        httpStatus: response.status,
        apiErrorCode: await readApiErrorCode(response),
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
    const accessToken = await this.fetchAccessToken();
    const range = `'${tabTitle.replace(/'/g, "''")}'`;
    const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
    const response = await this.fetcher(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      next: { revalidate: 300, tags: [this.cacheTag] },
    });
    if (!response.ok) {
      throw new OperationsGoogleSheetsReadError("Could not read workflow rows.", {
        stage: "sheet_values",
        httpStatus: response.status,
        apiErrorCode: await readApiErrorCode(response),
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
        next: { revalidate: 300, tags: [this.cacheTag] },
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

  /**
   * The real link target behind each cell in the given columns, keyed
   * `"<0-based row index>,<0-based column index>"` matching the same indices
   * `values.get` (`readTabValues`) returns rows/cells at — so a caller can
   * overlay this directly onto that grid. `CellData.hyperlink` is populated
   * by the Sheets API for both an explicit rich-text link (Insert > Link)
   * and a resolved `=HYPERLINK(url, label)` formula; `values.get` alone
   * returns only the second argument's rendered label in either case, which
   * is the exact inconsistency this exists to close. Scoped to `rowCount`
   * (the caller's own already-fetched row count), not a generous fixed
   * height like the validation scan — a hyperlink has no meaning on a row
   * that carries no data at all, and every column/range here comes from
   * `locateUrlColumns`'s server-side header discovery, never a caller-
   * supplied sheet name or range. Never throws: a read failure here falls
   * back to the plain display text everywhere, which is the existing
   * (imperfect but safe) behavior, never a broken or blank workflow.
   */
  async readCellHyperlinks(
    spreadsheetId: string,
    tabTitle: string,
    columnIndices: readonly number[],
    rowCount: number,
  ): Promise<Map<string, string>> {
    const hyperlinks = new Map<string, string>();
    if (columnIndices.length === 0 || rowCount <= 0) return hyperlinks;
    try {
      const accessToken = await this.fetchAccessToken();
      const escapedTitle = tabTitle.replace(/'/g, "''");
      const params = new URLSearchParams();
      for (const columnIndex of columnIndices) {
        const columnLetter = columnIndexToLetter(columnIndex);
        params.append("ranges", `'${escapedTitle}'!${columnLetter}1:${columnLetter}${rowCount}`);
      }
      params.set("fields", "sheets.data(startRow,startColumn,rowData.values.hyperlink)");

      const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?${params.toString()}`;
      const response = await this.fetcher(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        next: { revalidate: 300, tags: [this.cacheTag] },
      });
      if (!response.ok) return hyperlinks;

      const parsed = hyperlinkGridSchema.parse(await response.json());
      for (const sheet of parsed.sheets ?? []) {
        for (const data of sheet.data ?? []) {
          const baseRow = data.startRow ?? 0;
          const baseColumn = data.startColumn ?? 0;
          (data.rowData ?? []).forEach((rowData, rowOffset) => {
            (rowData.values ?? []).forEach((cell, columnOffset) => {
              if (cell.hyperlink) hyperlinks.set(`${baseRow + rowOffset},${baseColumn + columnOffset}`, cell.hyperlink);
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
