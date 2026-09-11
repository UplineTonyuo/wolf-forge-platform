import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { WebsiteBuilderGoogleSheetsEnvironment } from "../lib/env/google-sheets-env";
import { GoogleSheetsWebsiteBuilderWorkflowSource } from "../lib/integrations/website-builder-workflow-source";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ENVIRONMENT: WebsiteBuilderGoogleSheetsEnvironment = {
  GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
  GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  WEBSITE_BUILDER_SPREADSHEET_ID: "website-builder-sheet-123",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body));
}

describe("GoogleSheetsWebsiteBuilderWorkflowSource", () => {
  it("reads the canonical 'WEB BUILD ORDER' tab by exact title (case-insensitive) and resolves smart chips in one batched read", async () => {
    const rows = [
      ["", "Executive Name", "SEO Order#", "Business name", "Date Onboarded", "OB ", "ETA", "WEB Content", "Domain", "Status", "Bottleneck", "Actions"],
      ["", "", "1", "Business", "", "OB document", "", "Web content document", "example.com", "Completed"],
    ];
    const obUri = "https://docs.google.com/document/d/ob-doc/edit";
    const webContentUri = "https://drive.google.com/drive/folders/web-content";
    const calls: string[] = [];
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      calls.push(url);
      if (url.includes("oauth2.googleapis.com/token")) return jsonResponse({ access_token: "token", expires_in: 3600 });
      if (url.includes("fields=sheets.properties")) return jsonResponse({ sheets: [
        { properties: { title: "August", index: 12 } },
        { properties: { title: "web build order", index: 13 } },
        { properties: { title: "OFF-PAGE SEO DEPARTMENT (APRIL)", index: 14 } },
      ] });
      if (url.includes("/values/")) return jsonResponse({ values: rows });
      if (url.includes("chipRuns")) return jsonResponse({ sheets: [{ data: [
        { startRow: 0, startColumn: 5, rowData: [
          { values: [{ formattedValue: "OB " }] },
          { values: [{ formattedValue: "OB document", chipRuns: [{ chip: { richLinkProperties: { uri: obUri } } }] }] },
        ] },
        { startRow: 0, startColumn: 7, rowData: [
          { values: [{ formattedValue: "WEB Content" }] },
          { values: [{ formattedValue: "Web content document", hyperlink: webContentUri }] },
        ] },
      ] }] });
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const source = new GoogleSheetsWebsiteBuilderWorkflowSource(ENVIRONMENT, fetchMock as typeof fetch);
    const result = await source.fetchLatestTab();
    // Case-insensitive match against the real tab title, not the unrelated "August" or department tabs.
    expect(result.sourceTab).toBe("web build order");
    expect(result.rows[1]?.[5]).toBe(obUri);
    expect(result.rows[1]?.[7]).toBe(webContentUri);
    expect(calls.filter((url) => url.includes("chipRuns"))).toHaveLength(1);
  });
});
