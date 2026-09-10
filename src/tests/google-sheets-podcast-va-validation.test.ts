import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GoogleSheetsPodcastWorkflowSource } from "../lib/integrations/google-sheets-source";
import { PodcastWorkflowService } from "../services/podcast-workflow-service";
import type { GoogleSheetsEnvironment } from "../lib/env/google-sheets-env";

/**
 * A throwaway RSA keypair — real enough for `signServiceAccountJwt`'s
 * `createSign("RSA-SHA256").sign(...)` to succeed, never a real Google
 * credential. Generated once per test file, not per test.
 */
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const ENVIRONMENT: GoogleSheetsEnvironment = {
  GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
  GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  PODCAST_SEO_SPREADSHEET_ID: "sheet-123",
};

const TAB_TITLE = "PODCAST AUGUST 2026";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const TOKEN_RESPONSE = { access_token: "fake-access-token", expires_in: 3600, token_type: "Bearer" };
const METADATA_RESPONSE = { sheets: [{ properties: { title: TAB_TITLE, index: 0 } }] };

/**
 * Builds a fetch mock routing by URL shape, same pattern already used for
 * `usePodcastLiveSync` in `podcast-seo-live-view.test.tsx`. `dataValidationBody`
 * is the response for the validation-grid request; omit to make that branch
 * fail (simulating an outage) or leave routing to never hit it.
 */
function makeFetchMock(options: {
  rows: string[][];
  dataValidationBody?: unknown;
  dataValidationStatus?: number;
  hyperlinkBody?: unknown;
  hyperlinkStatus?: number;
  /**
   * Response for the Status-column-recovery request — distinguished from the
   * Assigned VA validation request (also `fields=...dataValidation`) by the
   * `startColumn` field it additionally requests. Omit to make that branch
   * fail; leave routing to never hit it when no block has a blank Status
   * header.
   */
  columnValidationBody?: unknown;
  columnValidationStatus?: number;
}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.includes("oauth2.googleapis.com/token")) return jsonResponse(TOKEN_RESPONSE);
    if (url.includes("fields=sheets.properties")) return jsonResponse(METADATA_RESPONSE);
    if (url.includes("/values/")) return jsonResponse({ values: options.rows });
    // No hyperlink anywhere in this fixture's cells by default — an empty
    // grid leaves every cell's plain display text untouched, matching each
    // existing test's `result.rows` expectation.
    if (url.includes("hyperlink")) {
      return jsonResponse(options.hyperlinkBody ?? { sheets: [] }, options.hyperlinkStatus ?? 200);
    }
    if (url.includes("startColumn")) {
      return jsonResponse(options.columnValidationBody ?? { sheets: [] }, options.columnValidationStatus ?? 200);
    }
    if (url.includes("dataValidation")) {
      return jsonResponse(options.dataValidationBody ?? { sheets: [] }, options.dataValidationStatus ?? 200);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  return { fetchMock, calls };
}

/** One hyperlink grid response for a single-column range, `rowIndex` 0-based matching `values.get`'s row order; `columnIndex` is the requested column's own 0-based sheet index (`startColumn`). */
function hyperlinkGridResponse(entries: { rowIndex: number; columnIndex: number; url: string }[]): unknown {
  const byColumn = new Map<number, { rowIndex: number; url: string }[]>();
  for (const entry of entries) {
    const list = byColumn.get(entry.columnIndex) ?? [];
    list.push(entry);
    byColumn.set(entry.columnIndex, list);
  }
  const data = [...byColumn.entries()].map(([columnIndex, columnEntries]) => {
    const maxRow = Math.max(...columnEntries.map((entry) => entry.rowIndex));
    const rowData = Array.from({ length: maxRow + 1 }, (_, rowIndex) => {
      const match = columnEntries.find((entry) => entry.rowIndex === rowIndex);
      return { values: [match ? { hyperlink: match.url } : {}] };
    });
    return { startRow: 0, startColumn: columnIndex, rowData };
  });
  return { sheets: [{ data }] };
}

/**
 * One hyperlink-grid response for a single cell shaped as a Google Docs/Drive
 * smart chip — `chipRuns` with a resolved `richLinkProperties.uri`, no
 * `hyperlink` key — the exact shape proven live against
 * seeitgonejunkremoval.com's real September 2026 PODCAST cell via
 * `spreadsheets.get` with `fields=...rowData.values(hyperlink,chipRuns)`.
 */
function chipGridResponse(rowIndex: number, columnIndex: number, uri: string | null): unknown {
  const rowData = Array.from({ length: rowIndex + 1 }, (_, index) =>
    index === rowIndex
      ? { values: [uri ? { chipRuns: [{ chip: { richLinkProperties: { uri } } }] } : { chipRuns: [{ chip: {} }] }] }
      : { values: [{}] },
  );
  return { sheets: [{ data: [{ startRow: 0, startColumn: columnIndex, rowData }] }] };
}

/** One data-validation grid response for a single-column range, `rowIndex` 0-based matching `values.get`'s row order. */
function oneOfListGridResponse(values: string[], atRowIndex: number): unknown {
  const rowData = Array.from({ length: atRowIndex + 1 }, (_, index) =>
    index === atRowIndex
      ? { values: [{ dataValidation: { condition: { type: "ONE_OF_LIST", values: values.map((v) => ({ userEnteredValue: v })) } } }] }
      : { values: [{}] },
  );
  return { sheets: [{ data: [{ rowData }] }] };
}

/**
 * A `readColumnValidationOptionSets` response — one `data` entry per
 * requested column, each carrying its own `startColumn` the way the real
 * Sheets API does for a multi-range `ranges=` request (verified live against
 * the real September 2026 workbook).
 */
function columnValidationGridResponse(columns: { columnIndex: number; values: string[]; atRowIndex: number }[]): unknown {
  const data = columns.map(({ columnIndex, values, atRowIndex }) => {
    const rowData = Array.from({ length: atRowIndex + 1 }, (_, index) =>
      index === atRowIndex
        ? { values: [{ dataValidation: { condition: { type: "ONE_OF_LIST", values: values.map((v) => ({ userEnteredValue: v })) } } }] }
        : { values: [{}] },
    );
    return { startColumn: columnIndex, rowData };
  });
  return { sheets: [{ data }] };
}

describe("GoogleSheetsPodcastWorkflowSource — Assigned VA data-validation options", () => {
  it("reads ONE_OF_LIST values from the Assigned VA column, including one with zero current rows", async () => {
    const header = ["Name", "PODCAST LINK", "Status 1", "Assigned Va"];
    const row = ["Ridgeline Plumbing", "https://podcast.example/ridgeline", "In Progress", "Sam"];
    const { fetchMock } = makeFetchMock({
      rows: [header, row],
      // "Sam" is the only value actually used in a row; the other three are validation-only.
      dataValidationBody: oneOfListGridResponse(["LayLay", "Rap", "Anthony", "Kyle"], 1),
    });

    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    const result = await source.fetchLatestPodcastTab();

    expect(result.rows).toEqual([header, row]);
    expect(result.assignedVaValidationOptions).toEqual(
      expect.arrayContaining(["LayLay", "Rap", "Anthony", "Kyle"]),
    );
  });

  it("issues no write request anywhere in the fetch — every Sheets call is a GET with no batchUpdate/update path, and the token scope is read-only", async () => {
    const header = ["Name", "PODCAST LINK", "Status 1", "Assigned Va"];
    const { fetchMock, calls } = makeFetchMock({
      rows: [header, ["Ridgeline Plumbing", "https://x", "In Progress", "Sam"]],
      dataValidationBody: oneOfListGridResponse(["LayLay", "Rap"], 1),
    });

    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    await source.fetchLatestPodcastTab();

    expect(calls.length).toBeGreaterThanOrEqual(4); // token + metadata + values + dataValidation
    for (const call of calls) {
      expect(call.url).not.toMatch(/batchUpdate|:update|\/values\/[^?]+:update/);
      if (call.url.includes("oauth2.googleapis.com/token")) {
        expect(call.init?.method).toBe("POST");
        // The JWT-bearer assertion carries `scope` inside its signed claims, not as a plain form field.
        const assertion = new URLSearchParams(String(call.init?.body)).get("assertion");
        const claims = JSON.parse(Buffer.from(String(assertion?.split(".")[1]), "base64url").toString("utf8"));
        expect(claims.scope).toBe("https://www.googleapis.com/auth/spreadsheets.readonly");
      } else {
        // Every Sheets API call (metadata, values, dataValidation) is a plain GET — no method override.
        expect(call.init?.method ?? "GET").toBe("GET");
      }
    }
  });

  it("falls back to an empty list, without failing the whole tab fetch, when the validation request fails", async () => {
    const header = ["Name", "PODCAST LINK", "Status 1", "Assigned Va"];
    const row = ["Ridgeline Plumbing", "https://x", "In Progress", "Sam"];
    const { fetchMock } = makeFetchMock({ rows: [header, row], dataValidationStatus: 500 });

    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    const result = await source.fetchLatestPodcastTab();

    expect(result.rows).toEqual([header, row]);
    expect(result.assignedVaValidationOptions).toEqual([]);
  });

  it("skips the validation request entirely when the tab has no Assigned VA column", async () => {
    const header = ["Name", "Status 1"];
    const row = ["Solo Client", "In Progress"];
    const { fetchMock, calls } = makeFetchMock({ rows: [header, row] });

    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    const result = await source.fetchLatestPodcastTab();

    expect(result.assignedVaValidationOptions).toEqual([]);
    expect(calls.some((call) => call.url.includes("dataValidation"))).toBe(false);
  });
});

describe("GoogleSheetsPodcastWorkflowSource — cell hyperlink resolution (View Output fix)", () => {
  it("replaces a friendly-label cell's text with its real hyperlink target end-to-end", async () => {
    const header = ["Name", "PODCAST LINK", "Status 1"];
    const row = ["Acme Co", "View Output", "Completed"];
    const { fetchMock } = makeFetchMock({
      rows: [header, row],
      hyperlinkBody: hyperlinkGridResponse([{ rowIndex: 1, columnIndex: 1, url: "https://podcast.example/acme" }]),
    });

    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    const result = await source.fetchLatestPodcastTab();

    expect(result.rows).toEqual([header, ["Acme Co", "https://podcast.example/acme", "Completed"]]);
  });

  it("leaves every cell's display text unchanged when no hyperlink is discovered anywhere", async () => {
    const header = ["Name", "PODCAST LINK", "Status 1"];
    const row = ["Beta LLC", "https://already-a-url.example", "Stuck"];
    const { fetchMock } = makeFetchMock({ rows: [header, row] });

    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    const result = await source.fetchLatestPodcastTab();

    expect(result.rows).toEqual([header, row]);
  });

  it("falls back to plain display text, without failing the whole tab fetch, when the hyperlink request fails", async () => {
    const header = ["Name", "PODCAST LINK", "Status 1"];
    const row = ["Gamma Inc", "View Output", "In Progress"];
    const { fetchMock } = makeFetchMock({ rows: [header, row], hyperlinkStatus: 500 });

    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    const result = await source.fetchLatestPodcastTab();

    expect(result.rows).toEqual([header, row]);
  });

  it("skips the hyperlink request entirely when the tab has no URL-bearing column", async () => {
    const header = ["Name", "Status 1"];
    const row = ["Solo Client", "In Progress"];
    const { fetchMock, calls } = makeFetchMock({ rows: [header, row] });

    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    await source.fetchLatestPodcastTab();

    expect(calls.some((call) => call.url.includes("hyperlink"))).toBe(false);
  });

  it("recovers a Google Docs/Drive smart chip cell's real target end-to-end, replacing the visible chip label — the real seeitgonejunkremoval.com shape", async () => {
    const header = ["Name", "PODCAST LINK", "Status 1"];
    const row = ["See It Gone Junk Removal", "See It Gone Junk Removal Podcast September 2026", "Completed"];
    const chipUri = "https://docs.google.com/document/d/1xMhyHncwFWYINn2TTc8c4Y6A_tjvj5UjPN5EMul2Ulo/edit?tab=t.0#heading=h.js12tcjji77h";
    const { fetchMock } = makeFetchMock({
      rows: [header, row],
      hyperlinkBody: chipGridResponse(1, 1, chipUri),
    });

    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    const result = await source.fetchLatestPodcastTab();

    expect(result.rows).toEqual([header, ["See It Gone Junk Removal", chipUri, "Completed"]]);
  });

  it("never fabricates a link from a chip's visible title when the chip carries no resolvable URI", async () => {
    const header = ["Name", "PODCAST LINK", "Status 1"];
    const row = ["Unresolved Chip Co", "See It Gone Podcast September 2026", "Completed"];
    const { fetchMock } = makeFetchMock({
      rows: [header, row],
      hyperlinkBody: chipGridResponse(1, 1, null),
    });

    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    const result = await source.fetchLatestPodcastTab();

    expect(result.rows).toEqual([header, row]);
  });
});

/**
 * Real September 2026 sheet's wide/top Podcast block header — byte-verified
 * against the live workbook. Columns K (10) and L (11) are genuinely blank
 * header cells; L carries a live ONE_OF_LIST validation of
 * "Completed"/"Inprogress"/"Stuck"/"cancelled"/"Paused" underneath, which is
 * why rows like seeitgonejunkremoval.com rendered as In Progress despite
 * being Completed in the sheet.
 */
const WIDE_BLOCK_HEADER = [
  "Name", "", "Email", "Logins", "Order #", "SEO Package", "Primary Keyword",
  "City", "PROMPT/ SOP", "PODCAST LINK", "", "", "Notes", "Assigned Va",
];

describe("GoogleSheetsPodcastWorkflowSource — Status-column recovery for a blank header cell", () => {
  it("recovers Completed for the wide block whose Status column has no header text, once its dropdown matches the Status vocabulary", async () => {
    const row = [
      "https://seeitgonejunkremoval.com/", "", "seeitgone.junk@gmail.com", "", "4B74F54B_3", "Platinum",
      "Junk removal", "Marysville", "", "See It Gone Junk Removal August 2026 Podcast",
      "See It Gone Junk Removal Podcast September 2026", "Completed",
    ];
    const { fetchMock } = makeFetchMock({
      rows: [WIDE_BLOCK_HEADER, row],
      columnValidationBody: columnValidationGridResponse([
        { columnIndex: 1, values: [], atRowIndex: 0 },
        { columnIndex: 10, values: [], atRowIndex: 0 },
        { columnIndex: 11, values: ["Completed", "Inprogress", "Stuck", "cancelled", "Paused"], atRowIndex: 1 },
      ]),
    });

    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    const result = await source.fetchLatestPodcastTab();

    expect(result.rows[0]?.[11]).toBe("Status");
    expect(result.rows[1]).toEqual(row);
  });

  it("never issues a Status-recovery request for a block whose header already names Status 1 by text (e.g. Hot Mess Cleanup & Junk Removal's compact block)", async () => {
    const header = ["Name", "", "PODCAST LINK", "Status 1", "Assigned Va"];
    const row = ["Hot Mess Cleanup & Junk Removal", "", "https://podcast.example/hotmess", "Completed", "Kyle"];
    const { fetchMock, calls } = makeFetchMock({ rows: [header, row] });

    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    const result = await source.fetchLatestPodcastTab();

    // Not just "startColumn": the block's own PODCAST LINK cell legitimately
    // triggers the pre-existing hyperlink-resolution request, whose fields
    // param (`startRow,startColumn,rowData.values.hyperlink`) also contains
    // that substring. Only the recovery request's fields param carries both
    // "startColumn" and "dataValidation" together.
    expect(calls.some((call) => call.url.includes("startColumn") && call.url.includes("dataValidation"))).toBe(false);
    expect(result.rows).toEqual([header, row]);
  });

  it("falls back to leaving the header blank (still In Progress, the pre-existing safe default), without failing the whole tab fetch, when the recovery request fails", async () => {
    const row = ["Acme Co", "", "", "", "", "Platinum", "", "", "", "", "", "Completed"];
    const { fetchMock } = makeFetchMock({
      rows: [WIDE_BLOCK_HEADER, row],
      columnValidationStatus: 500,
    });

    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    const result = await source.fetchLatestPodcastTab();

    expect(result.rows[0]?.[11]).toBe("");
  });

  it("does not recover a blank header column whose dropdown is unrelated to Status (a department tag or VA names)", async () => {
    const row = ["Acme Co", "", "", "", "", "Platinum", "", "", "", "", "", "Completed"];
    const { fetchMock } = makeFetchMock({
      rows: [WIDE_BLOCK_HEADER, row],
      columnValidationBody: columnValidationGridResponse([
        { columnIndex: 1, values: [], atRowIndex: 0 },
        { columnIndex: 10, values: ["PODS"], atRowIndex: 1 },
        { columnIndex: 11, values: [], atRowIndex: 0 },
      ]),
    });

    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    const result = await source.fetchLatestPodcastTab();

    expect(result.rows[0]?.[10]).toBe("");
    expect(result.rows[0]?.[11]).toBe("");
  });
});

/**
 * Request-count regression coverage for the 429/RESOURCE_EXHAUSTED quota
 * issue found in local QA: `PodcastWorkflowService.getSnapshotForMonth`
 * discovers the month allowlist via `listAvailablePodcastMonths` (one
 * `listTabs` call), then fetches exactly one tab's data by the title that
 * discovery just returned — it must never issue a second, redundant
 * spreadsheet-metadata request for the same snapshot build, and switching
 * the requested month must not multiply that metadata call either. Two
 * generic dated months (never the specific September workbook or any real
 * client) are enough to exercise this.
 */
describe("PodcastWorkflowService.getSnapshotForMonth — real Google Sheets source request count", () => {
  const AUGUST_TAB = "PODCAST AUGUST 2026";
  const JULY_TAB = "PODCAST JULY 2026";
  const TWO_MONTH_METADATA = {
    sheets: [
      { properties: { title: AUGUST_TAB, index: 0 } },
      { properties: { title: JULY_TAB, index: 1 } },
    ],
  };
  const HEADER = ["Name", "Status 1"];

  function makeTwoMonthFetchMock() {
    const calls: { url: string }[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push({ url });
      if (url.includes("oauth2.googleapis.com/token")) return jsonResponse(TOKEN_RESPONSE);
      if (url.includes("fields=sheets.properties")) return jsonResponse(TWO_MONTH_METADATA);
      if (url.includes(`/values/${encodeURIComponent(`'${AUGUST_TAB}'`)}`)) {
        return jsonResponse({ values: [HEADER, ["Acme Co", "Completed"]] });
      }
      if (url.includes(`/values/${encodeURIComponent(`'${JULY_TAB}'`)}`)) {
        return jsonResponse({ values: [HEADER, ["Beta LLC", "Stuck"]] });
      }
      if (url.includes("hyperlink") || url.includes("dataValidation") || url.includes("startColumn")) {
        return jsonResponse({ sheets: [] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    return { fetchMock, calls };
  }

  it("issues exactly one spreadsheet-metadata (listTabs) request for one full snapshot build, never a duplicate", async () => {
    const { fetchMock, calls } = makeTwoMonthFetchMock();
    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    const service = new PodcastWorkflowService(source);

    const bundle = await service.getSnapshotForMonth(null);

    const metadataCalls = calls.filter((call) => call.url.includes("fields=sheets.properties"));
    expect(metadataCalls).toHaveLength(1);
    expect(bundle.snapshot.sourceMonth).toBe(AUGUST_TAB);
  });

  it("switching the requested month still issues exactly one metadata request, and fetches only the newly selected tab's values", async () => {
    const { fetchMock, calls } = makeTwoMonthFetchMock();
    const source = new GoogleSheetsPodcastWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);
    const service = new PodcastWorkflowService(source);

    const bundle = await service.getSnapshotForMonth("2026-07");

    const metadataCalls = calls.filter((call) => call.url.includes("fields=sheets.properties"));
    expect(metadataCalls).toHaveLength(1);
    expect(calls.some((call) => call.url.includes(encodeURIComponent(`'${AUGUST_TAB}'`)))).toBe(false);
    expect(bundle.snapshot.sourceMonth).toBe(JULY_TAB);
    expect(bundle.snapshot.items[0]).toMatchObject({ clientName: "Beta LLC", normalizedStatus: "stuck" });
  });
});
