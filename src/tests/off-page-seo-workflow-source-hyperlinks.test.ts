import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { OffPageSeoGoogleSheetsEnvironment } from "../lib/env/google-sheets-env";
import { GoogleSheetsOffPageSeoWorkflowSource } from "../lib/integrations/off-page-seo-workflow-source";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ENVIRONMENT: OffPageSeoGoogleSheetsEnvironment = {
  GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
  GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  OFF_PAGE_SEO_SPREADSHEET_ID: "off-page-sheet-123",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body));
}

describe("GoogleSheetsOffPageSeoWorkflowSource hyperlink recovery", () => {
  it("resolves deliverable smart-chip metadata in the shared batched read", async () => {
    const rows = [
      ["Name", "SEO Package", "Cloudstack", "Status"],
      ["Client", "Platinum", "Stack folder", "Done"],
    ];
    const chipUri = "https://drive.google.com/drive/folders/off-page-cloudstack";
    const calls: string[] = [];
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      calls.push(url);
      if (url.includes("oauth2.googleapis.com/token")) return jsonResponse({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      if (url.includes("/values/")) return jsonResponse({ values: rows });
      if (url.includes("chipRuns")) return jsonResponse({ sheets: [{ data: [{ startRow: 0, startColumn: 0, rowData: [] }, { startRow: 0, startColumn: 2, rowData: [
        { values: [{ formattedValue: "Cloudstack" }] },
        { values: [{ formattedValue: "Stack folder", chipRuns: [{ chip: { richLinkProperties: { uri: chipUri } } }] }] },
      ] }] }] });
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const result = await new GoogleSheetsOffPageSeoWorkflowSource(ENVIRONMENT, fetchMock as typeof fetch).fetchTab("OFF PAGE SEO SEPTEMBER 2026");
    expect(result.rows[1]?.[2]).toBe(chipUri);
    expect(calls.filter((url) => url.includes("chipRuns"))).toHaveLength(1);
  });
});
