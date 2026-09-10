import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { GmbManagementGoogleSheetsEnvironment } from "../lib/env/google-sheets-env";
import { GoogleSheetsGmbManagementWorkflowSource } from "../lib/integrations/gmb-management-workflow-source";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ENVIRONMENT: GmbManagementGoogleSheetsEnvironment = {
  GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
  GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  GMB_MANAGEMENT_SPREADSHEET_ID: "gmb-sheet-123",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body));
}

describe("GoogleSheetsGmbManagementWorkflowSource", () => {
  it("discovers month-only tabs and resolves stage smart chips in one batched read", async () => {
    const rows = [
      ["Name", "GMB CONTENT", "Status", "20 GMB POSTED", "Status 1"],
      ["Client", "Content document", "Completed", "Posting document", "Completed"],
    ];
    const contentUri = "https://docs.google.com/document/d/gmb-content/edit";
    const postingUri = "https://drive.google.com/file/d/gmb-posting/view";
    const calls: string[] = [];
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      calls.push(url);
      if (url.includes("oauth2.googleapis.com/token")) return jsonResponse({ access_token: "token", expires_in: 3600 });
      if (url.includes("fields=sheets.properties")) return jsonResponse({ sheets: [
        { properties: { title: "GMB MANAGEMENT DEPARTMENT (JUNE)", index: 4 } },
        { properties: { title: "July 2026", index: 6 } },
        { properties: { title: "AUGUST 2026", index: 7 } },
        { properties: { title: "SEPTEMBER 2026", index: 8 } },
        { properties: { title: "CONTENT SEPTEMBER 2026", index: 9 } },
      ] });
      if (url.includes("/values/")) return jsonResponse({ values: rows });
      if (url.includes("chipRuns")) return jsonResponse({ sheets: [{ data: [
        { startRow: 0, startColumn: 0, rowData: [] },
        { startRow: 0, startColumn: 1, rowData: [
          { values: [{ formattedValue: "GMB CONTENT" }] },
          { values: [{ formattedValue: "Content document", chipRuns: [{ chip: { richLinkProperties: { uri: contentUri } } }] }] },
        ] },
        { startRow: 0, startColumn: 3, rowData: [
          { values: [{ formattedValue: "20 GMB POSTED" }] },
          { values: [{ formattedValue: "Posting document", hyperlink: postingUri }] },
        ] },
      ] }] });
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const source = new GoogleSheetsGmbManagementWorkflowSource(ENVIRONMENT, fetchMock as typeof fetch);
    expect((await source.listAvailableMonths()).map((month) => month.value)).toEqual(["2026-09", "2026-08", "2026-07"]);
    const result = await source.fetchTab("SEPTEMBER 2026");
    expect(result.rows[1]?.[1]).toBe(contentUri);
    expect(result.rows[1]?.[3]).toBe(postingUri);
    expect(calls.filter((url) => url.includes("chipRuns"))).toHaveLength(1);
  });
});
