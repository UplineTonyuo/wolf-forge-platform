import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { OnPageSeoGoogleSheetsEnvironment } from "../lib/env/google-sheets-env";
import { GoogleSheetsOnPageSeoWorkflowSource } from "../lib/integrations/on-page-seo-workflow-source";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ENVIRONMENT: OnPageSeoGoogleSheetsEnvironment = {
  GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
  GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  ON_PAGE_SEO_SPREADSHEET_ID: "on-page-sheet-123",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body));
}

describe("GoogleSheetsOnPageSeoWorkflowSource hyperlink recovery", () => {
  it("resolves deliverable smart-chip metadata in the shared batched read", async () => {
    const rows = [
      ["Name", "Assigned VA", "SEO Package", "ONPAGE AUDIT", "Status"],
      ["Client", "Jordan", "Platinum", "Audit document", "Done"],
    ];
    const chipUri = "https://docs.google.com/document/d/on-page-audit/edit";
    const calls: string[] = [];
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      calls.push(url);
      if (url.includes("oauth2.googleapis.com/token")) return jsonResponse({ access_token: "token", expires_in: 3600, token_type: "Bearer" });
      if (url.includes("/values/")) return jsonResponse({ values: rows });
      if (url.includes("chipRuns")) return jsonResponse({ sheets: [{ data: [{ startRow: 0, startColumn: 0, rowData: [] }, { startRow: 0, startColumn: 3, rowData: [
        { values: [{ formattedValue: "ONPAGE AUDIT" }] },
        { values: [{ formattedValue: "Audit document", chipRuns: [{ chip: { richLinkProperties: { uri: chipUri } } }] }] },
      ] }] }] });
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const result = await new GoogleSheetsOnPageSeoWorkflowSource(ENVIRONMENT, fetchMock as typeof fetch).fetchTab("OnPage September 2026");
    expect(result.rows[1]?.[3]).toBe(chipUri);
    expect(calls.filter((url) => url.includes("chipRuns"))).toHaveLength(1);
  });
});
