import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { YoutubeSeoGoogleSheetsEnvironment } from "../lib/env/google-sheets-env";
import { GoogleSheetsYoutubeSeoWorkflowSource } from "../lib/integrations/youtube-seo-workflow-source";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ENVIRONMENT: YoutubeSeoGoogleSheetsEnvironment = {
  GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
  GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  YOUTUBE_SEO_SPREADSHEET_ID: "youtube-sheet-123",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body));
}

describe("GoogleSheetsYoutubeSeoWorkflowSource", () => {
  it("discovers 'YT SEO <Month> <Year>' tabs (ignoring legacy undated and unrelated department tabs) and resolves stage smart chips in one batched read", async () => {
    const rows = [
      ["Name", "Wave Video", "STATUS 1", "YT Uploaded", "STATUS 2"],
      ["Client", "Wave document", "Completed", "Upload document", "Completed"],
    ];
    const waveUri = "https://docs.google.com/document/d/youtube-wave/edit";
    const uploadUri = "https://drive.google.com/file/d/youtube-upload/view";
    const calls: string[] = [];
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      calls.push(url);
      if (url.includes("oauth2.googleapis.com/token")) return jsonResponse({ access_token: "token", expires_in: 3600 });
      if (url.includes("fields=sheets.properties")) return jsonResponse({ sheets: [
        { properties: { title: "YOUTUBE SEO DEPARTMENT (JUNE)", index: 4 } },
        { properties: { title: "YT SEO July 2026", index: 6 } },
        { properties: { title: "YT SEO August 2026", index: 7 } },
        { properties: { title: "YT SEO September 2026", index: 8 } },
        { properties: { title: "CONTENT SEPTEMBER 2026", index: 9 } },
      ] });
      if (url.includes("/values/")) return jsonResponse({ values: rows });
      if (url.includes("chipRuns")) return jsonResponse({ sheets: [{ data: [
        { startRow: 0, startColumn: 0, rowData: [] },
        { startRow: 0, startColumn: 1, rowData: [
          { values: [{ formattedValue: "Wave Video" }] },
          { values: [{ formattedValue: "Wave document", chipRuns: [{ chip: { richLinkProperties: { uri: waveUri } } }] }] },
        ] },
        { startRow: 0, startColumn: 3, rowData: [
          { values: [{ formattedValue: "YT Uploaded" }] },
          { values: [{ formattedValue: "Upload document", hyperlink: uploadUri }] },
        ] },
      ] }] });
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const source = new GoogleSheetsYoutubeSeoWorkflowSource(ENVIRONMENT, fetchMock as typeof fetch);
    expect((await source.listAvailableMonths()).map((month) => month.value)).toEqual(["2026-09", "2026-08", "2026-07"]);
    const result = await source.fetchTab("YT SEO September 2026");
    expect(result.rows[1]?.[1]).toBe(waveUri);
    expect(result.rows[1]?.[3]).toBe(uploadUri);
    expect(calls.filter((url) => url.includes("chipRuns"))).toHaveLength(1);
  });
});
