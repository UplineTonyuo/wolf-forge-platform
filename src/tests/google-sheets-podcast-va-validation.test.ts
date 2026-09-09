import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GoogleSheetsPodcastWorkflowSource } from "../lib/integrations/google-sheets-source";
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

/** One data-validation grid response for a single-column range, `rowIndex` 0-based matching `values.get`'s row order. */
function oneOfListGridResponse(values: string[], atRowIndex: number): unknown {
  const rowData = Array.from({ length: atRowIndex + 1 }, (_, index) =>
    index === atRowIndex
      ? { values: [{ dataValidation: { condition: { type: "ONE_OF_LIST", values: values.map((v) => ({ userEnteredValue: v })) } } }] }
      : { values: [{}] },
  );
  return { sheets: [{ data: [{ rowData }] }] };
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
});
