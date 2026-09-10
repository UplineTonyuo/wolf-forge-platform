import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GoogleSheetsContentWorkflowSource } from "../lib/integrations/content-workflow-source";
import type { ContentGoogleSheetsEnvironment } from "../lib/env/google-sheets-env";

/**
 * Source-layer proof that `fetchLatestContentTab` itself reaches
 * `OperationsGoogleSheetsReader.readCellHyperlinks()` for the BLOG/CONTENT
 * column, not just that the domain helpers work in isolation. Before this
 * fix, `fetchLatestContentTab` called only `readTabValues` — a real Google
 * Docs/Drive smart chip cell's stored URI was never requested from the
 * Sheets API at all, regardless of what the domain parser could do with it.
 */

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const ENVIRONMENT: ContentGoogleSheetsEnvironment = {
  GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
  GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  CONTENT_WORKFLOW_SPREADSHEET_ID: "content-sheet-123",
};

const TAB_TITLE = "CONTENT AUGUST 2026";
const TOKEN_RESPONSE = { access_token: "fake-access-token", expires_in: 3600, token_type: "Bearer" };
const METADATA_RESPONSE = { sheets: [{ properties: { title: TAB_TITLE, index: 0 } }] };

const HEADER = ["Website", "Email", "logins", "Order #", "SEO Package", "Primary Keyword", "City", "PROMPT / SOP", "4 Blog Content", "Status"];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeFetchMock(rows: string[][], hyperlinkBody: unknown) {
  const calls: string[] = [];
  const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url.includes("oauth2.googleapis.com/token")) return jsonResponse(TOKEN_RESPONSE);
    if (url.includes("fields=sheets.properties")) return jsonResponse(METADATA_RESPONSE);
    if (url.includes("/values/")) return jsonResponse({ values: rows });
    if (url.includes("chipRuns")) return jsonResponse(hyperlinkBody);
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetchMock, calls };
}

describe("GoogleSheetsContentWorkflowSource.fetchLatestContentTab — hyperlink recovery", () => {
  it("resolves a Google Docs smart chip's real URI for the BLOG/CONTENT column end-to-end", async () => {
    const rows = [
      HEADER,
      ["daluxjunkremoval.com", "", "", "", "", "", "", "", "Dalux Blog Content", "Completed"],
    ];
    const chipUri = "https://docs.google.com/document/d/dalux-smart-chip/edit";
    const hyperlinkBody = {
      sheets: [{
        data: [{
          startRow: 0,
          startColumn: 8,
          rowData: [
            { values: [{ formattedValue: "4 Blog Content" }] },
            { values: [{ formattedValue: "Dalux Blog Content", chipRuns: [{ chip: { richLinkProperties: { uri: chipUri } } }] }] },
          ],
        }],
      }],
    };
    const { fetchMock } = makeFetchMock(rows, hyperlinkBody);
    const source = new GoogleSheetsContentWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);

    const result = await source.fetchLatestContentTab();

    expect(result.rows[1]?.[8]).toBe(chipUri);
  });

  it("leaves a raw literal URL cell untouched when no chip/hyperlink metadata is discovered", async () => {
    const literalUrl = "https://docs.google.com/document/d/dfwairductcleaning-raw/edit";
    const rows = [
      HEADER,
      ["dfwairductcleaning.com", "", "", "", "", "", "", "", literalUrl, "Completed"],
    ];
    const { fetchMock } = makeFetchMock(rows, { sheets: [] });
    const source = new GoogleSheetsContentWorkflowSource(ENVIRONMENT, fetchMock as unknown as typeof fetch);

    const result = await source.fetchLatestContentTab();

    expect(result.rows[1]?.[8]).toBe(literalUrl);
  });
});
