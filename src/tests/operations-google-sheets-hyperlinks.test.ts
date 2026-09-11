import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { OperationsGoogleSheetsReader } from "../lib/integrations/operations-google-sheets";
import type { GoogleSheetsServiceAccountEnvironment } from "../lib/env/google-sheets-env";

/**
 * A throwaway RSA keypair — real enough for `signServiceAccountJwt`'s
 * `createSign("RSA-SHA256").sign(...)` to succeed, never a real Google
 * credential. Generated once per test file, not per test.
 */
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const ENVIRONMENT: GoogleSheetsServiceAccountEnvironment = {
  GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
  GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};

const SPREADSHEET_ID = "sheet-hyperlinks-test";
const TOKEN_RESPONSE = { access_token: "fake-access-token", expires_in: 3600, token_type: "Bearer" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Every real `CellData` shape this suite proves against was verified live
 * against the real September 2026 Podcast workbook (`spreadsheets.get` with
 * `fields=...rowData.values(hyperlink,chipRuns)`), not assumed:
 *
 * - seeitgonejunkremoval.com's PODCAST cell: `formattedValue` was the
 *   friendly label "See It Gone Junk Removal Podcast September 2026", no
 *   `hyperlink` key at all, and a `chipRuns: [{ chip: { richLinkProperties:
 *   { uri: "https://docs.google.com/document/d/..." } } }]` — a genuine,
 *   unconverted Google Docs smart chip.
 * - readysetjunkbayarea.com's and trexexpresshauling.com's PODCAST cells (at
 *   the time of this fix): a raw pasted URL, reported by the API as both
 *   `formattedValue` (the literal URL text) and a matching `hyperlink`
 *   (Sheets auto-linkifies a bare URL string) — the pre-existing, already-
 *   supported representation.
 */
function makeFetchMock(cellsByRange: Record<string, unknown>) {
  const calls: { url: string }[] = [];
  const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push({ url });
    if (url.includes("oauth2.googleapis.com/token")) return jsonResponse(TOKEN_RESPONSE);
    for (const [marker, body] of Object.entries(cellsByRange)) {
      if (url.includes(marker)) return jsonResponse(body);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetchMock, calls };
}

function singleCellGrid(cell: unknown): unknown {
  return { sheets: [{ data: [{ startRow: 0, startColumn: 0, rowData: [{ values: [cell] }] }] }] };
}

describe("OperationsGoogleSheetsReader.readCellHyperlinks — link representation priority", () => {
  it("A: recovers a raw/literal URL cell exactly as before (hyperlink field matches the displayed text)", async () => {
    const url = "https://docs.google.com/document/d/1sTa4wLfFyvUIUhpNkU2SEVW1csLt2Y3HT_AF0Hs6YCE/edit";
    const { fetchMock } = makeFetchMock({
      A1: singleCellGrid({ formattedValue: url, hyperlink: url }),
    });
    const reader = new OperationsGoogleSheetsReader(ENVIRONMENT, "tag", fetchMock as unknown as typeof fetch);

    const result = await reader.readCellHyperlinks(SPREADSHEET_ID, "Tab", [0], 1);

    expect(result.get("0,0")).toBe(url);
  });

  it("B: recovers an ordinary rich-text/HYPERLINK() cell exactly as before (displayed label differs from the URL)", async () => {
    const url = "https://podcast.example/real-episode";
    const { fetchMock } = makeFetchMock({
      A1: singleCellGrid({ formattedValue: "View Output", hyperlink: url }),
    });
    const reader = new OperationsGoogleSheetsReader(ENVIRONMENT, "tag", fetchMock as unknown as typeof fetch);

    const result = await reader.readCellHyperlinks(SPREADSHEET_ID, "Tab", [0], 1);

    expect(result.get("0,0")).toBe(url);
  });

  it("C: recovers a Google Docs/Drive smart chip's underlying URI (chipRuns, no hyperlink field) — the real shape proven against the live workbook", async () => {
    const chipUri = "https://docs.google.com/document/d/1xMhyHncwFWYINn2TTc8c4Y6A_tjvj5UjPN5EMul2Ulo/edit?tab=t.0#heading=h.js12tcjji77h";
    const { fetchMock } = makeFetchMock({
      A1: singleCellGrid({
        formattedValue: "See It Gone Junk Removal Podcast September 2026",
        chipRuns: [{ chip: { richLinkProperties: { uri: chipUri, mimeType: "application/vnd.google-apps.kix" } } }],
      }),
    });
    const reader = new OperationsGoogleSheetsReader(ENVIRONMENT, "tag", fetchMock as unknown as typeof fetch);

    const result = await reader.readCellHyperlinks(SPREADSHEET_ID, "Tab", [0], 1);

    expect(result.get("0,0")).toBe(chipUri);
  });

  it("D: never fabricates a link for a chip's visible title when no underlying URI is present", async () => {
    const { fetchMock } = makeFetchMock({
      // A chipRuns entry can in principle exist without a resolved richLinkProperties.uri
      // (e.g. a chip type this reader doesn't recognize) — must not become a link.
      A1: singleCellGrid({ formattedValue: "See It Gone Podcast September 2026", chipRuns: [{ chip: {} }] }),
    });
    const reader = new OperationsGoogleSheetsReader(ENVIRONMENT, "tag", fetchMock as unknown as typeof fetch);

    const result = await reader.readCellHyperlinks(SPREADSHEET_ID, "Tab", [0], 1);

    expect(result.has("0,0")).toBe(false);
  });

  it("does not fabricate a link for a plain text cell with neither hyperlink nor chipRuns", async () => {
    const { fetchMock } = makeFetchMock({ A1: singleCellGrid({ formattedValue: "Not available" }) });
    const reader = new OperationsGoogleSheetsReader(ENVIRONMENT, "tag", fetchMock as unknown as typeof fetch);

    const result = await reader.readCellHyperlinks(SPREADSHEET_ID, "Tab", [0], 1);

    expect(result.size).toBe(0);
  });

  it("gives CellData.hyperlink priority over chipRuns when a cell somehow reports both", async () => {
    const hyperlinkUrl = "https://hyperlink-wins.example/target";
    const chipUri = "https://chip-loses.example/target";
    const { fetchMock } = makeFetchMock({
      A1: singleCellGrid({
        formattedValue: "Ambiguous cell",
        hyperlink: hyperlinkUrl,
        chipRuns: [{ chip: { richLinkProperties: { uri: chipUri } } }],
      }),
    });
    const reader = new OperationsGoogleSheetsReader(ENVIRONMENT, "tag", fetchMock as unknown as typeof fetch);

    const result = await reader.readCellHyperlinks(SPREADSHEET_ID, "Tab", [0], 1);

    expect(result.get("0,0")).toBe(hyperlinkUrl);
  });

  it("requests chipRuns alongside hyperlink in the fields mask", async () => {
    const { fetchMock, calls } = makeFetchMock({ A1: singleCellGrid({ formattedValue: "x" }) });
    const reader = new OperationsGoogleSheetsReader(ENVIRONMENT, "tag", fetchMock as unknown as typeof fetch);

    await reader.readCellHyperlinks(SPREADSHEET_ID, "Tab", [0], 1);

    const sheetsCall = calls.find((call) => !call.url.includes("oauth2.googleapis.com"));
    expect(sheetsCall?.url).toContain("chipRuns");
    expect(sheetsCall?.url).toContain("hyperlink");
  });
});
