import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  OperationsGoogleSheetsReadError,
  OperationsGoogleSheetsReader,
} from "../lib/integrations/operations-google-sheets";
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

const TOKEN_RESPONSE = { access_token: "fake-access-token", expires_in: 3600, token_type: "Bearer" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * The rate-limit cooldown this suite exercises lives at module scope in
 * `operations-google-sheets.ts`, keyed by spreadsheet id — real behavior,
 * since the Sheets API quota it protects is genuinely shared across every
 * request hitting the same spreadsheet in one server process. Each test
 * below therefore uses its own never-reused spreadsheet id, the same way two
 * unrelated real spreadsheets would never share a cooldown, so tests can run
 * in any order without one test's 429 leaking into another's assertions.
 */
let spreadsheetIdCounter = 0;
function uniqueSpreadsheetId(): string {
  spreadsheetIdCounter += 1;
  return `qa-rate-limit-sheet-${spreadsheetIdCounter}`;
}

/** Routes token exchange for real; every other call is answered by `handleSheetsCall`, which also records call metadata. */
function makeFetchMock(handleSheetsCall: (url: string) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("oauth2.googleapis.com/token")) return jsonResponse(TOKEN_RESPONSE);
    return handleSheetsCall(url);
  };
  return { fetchMock, calls };
}

const RESOURCE_EXHAUSTED_BODY = { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded." } };

describe("OperationsGoogleSheetsReader — real caching opt-in", () => {
  it("passes cache: 'force-cache' alongside next.revalidate/tags on every Sheets metadata/values/validation/hyperlink request", async () => {
    const spreadsheetId = uniqueSpreadsheetId();
    const { fetchMock, calls } = makeFetchMock(() => jsonResponse({ sheets: [] }));
    const reader = new OperationsGoogleSheetsReader(ENVIRONMENT, "qa-cache-tag", fetchMock as unknown as typeof fetch);

    await reader.listTabs(spreadsheetId);
    await reader.readTabValues(spreadsheetId, "Tab");
    await reader.readListValidationOptions(spreadsheetId, "Tab", [0]);
    await reader.readColumnValidationOptionSets(spreadsheetId, "Tab", [0]);
    await reader.readCellHyperlinks(spreadsheetId, "Tab", [0], 5);

    const sheetsCalls = calls.filter((call) => !call.url.includes("oauth2.googleapis.com"));
    expect(sheetsCalls.length).toBe(5);
    for (const call of sheetsCalls) {
      expect(call.init?.cache).toBe("force-cache");
      expect((call.init as { next?: { revalidate?: number; tags?: string[] } } | undefined)?.next).toEqual({
        revalidate: 300,
        tags: ["qa-cache-tag"],
      });
    }
    // The JWT token exchange deliberately stays uncached — it's a distinct, short-lived credential, not sheet data.
    const tokenCall = calls.find((call) => call.url.includes("oauth2.googleapis.com"));
    expect(tokenCall?.init?.cache).toBe("no-store");
  });
});

describe("OperationsGoogleSheetsReader — bounded 429/RESOURCE_EXHAUSTED cooldown", () => {
  it("starts a cooldown on a RESOURCE_EXHAUSTED response and fails the next call to the same spreadsheet without any further network request", async () => {
    const spreadsheetId = uniqueSpreadsheetId();
    let sheetsCallCount = 0;
    const { fetchMock } = makeFetchMock(() => {
      sheetsCallCount += 1;
      return jsonResponse(RESOURCE_EXHAUSTED_BODY, 429);
    });
    const reader = new OperationsGoogleSheetsReader(ENVIRONMENT, "qa-cache-tag", fetchMock as unknown as typeof fetch);

    await expect(reader.listTabs(spreadsheetId)).rejects.toMatchObject({
      httpStatus: 429,
      apiErrorCode: "RESOURCE_EXHAUSTED",
    });
    expect(sheetsCallCount).toBe(1);

    // The very next call — even a different method — must fail fast from the
    // in-process cooldown, never re-hitting an already-exhausted quota.
    await expect(reader.readTabValues(spreadsheetId, "Tab")).rejects.toBeInstanceOf(
      OperationsGoogleSheetsReadError,
    );
    expect(sheetsCallCount).toBe(1);
  });

  it("keeps fail-open reads (validation options, column validation sets, hyperlinks) fail-open — no throw, no network call — during a cooldown", async () => {
    const spreadsheetId = uniqueSpreadsheetId();
    let sheetsCallCount = 0;
    const { fetchMock } = makeFetchMock(() => {
      sheetsCallCount += 1;
      return jsonResponse(RESOURCE_EXHAUSTED_BODY, 429);
    });
    const reader = new OperationsGoogleSheetsReader(ENVIRONMENT, "qa-cache-tag", fetchMock as unknown as typeof fetch);

    await expect(reader.listTabs(spreadsheetId)).rejects.toBeInstanceOf(OperationsGoogleSheetsReadError);
    expect(sheetsCallCount).toBe(1);

    await expect(reader.readListValidationOptions(spreadsheetId, "Tab", [0])).resolves.toEqual([]);
    await expect(reader.readColumnValidationOptionSets(spreadsheetId, "Tab", [0])).resolves.toEqual(new Map());
    await expect(reader.readCellHyperlinks(spreadsheetId, "Tab", [0], 5)).resolves.toEqual(new Map());
    expect(sheetsCallCount).toBe(1);
  });

  it("scopes the cooldown to one spreadsheet id — a different spreadsheet is unaffected", async () => {
    const rateLimitedSpreadsheetId = uniqueSpreadsheetId();
    const healthySpreadsheetId = uniqueSpreadsheetId();
    const { fetchMock } = makeFetchMock((url) =>
      url.includes(encodeURIComponent(rateLimitedSpreadsheetId))
        ? jsonResponse(RESOURCE_EXHAUSTED_BODY, 429)
        : jsonResponse({ sheets: [{ properties: { title: "Tab", index: 0 } }] }),
    );
    const reader = new OperationsGoogleSheetsReader(ENVIRONMENT, "qa-cache-tag", fetchMock as unknown as typeof fetch);

    await expect(reader.listTabs(rateLimitedSpreadsheetId)).rejects.toBeInstanceOf(OperationsGoogleSheetsReadError);
    await expect(reader.listTabs(healthySpreadsheetId)).resolves.toEqual([{ title: "Tab", index: 0 }]);
  });

  it("does not start a cooldown on an ordinary (non-429, non-RESOURCE_EXHAUSTED) failure", async () => {
    const spreadsheetId = uniqueSpreadsheetId();
    let sheetsCallCount = 0;
    const { fetchMock } = makeFetchMock(() => {
      sheetsCallCount += 1;
      return jsonResponse({ error: { code: 500, status: "INTERNAL" } }, 500);
    });
    const reader = new OperationsGoogleSheetsReader(ENVIRONMENT, "qa-cache-tag", fetchMock as unknown as typeof fetch);

    await expect(reader.listTabs(spreadsheetId)).rejects.toBeInstanceOf(OperationsGoogleSheetsReadError);
    expect(sheetsCallCount).toBe(1);

    // A plain 500 is not a quota signal — the next call still tries Google again (fails again here, but it *tries*).
    await expect(reader.listTabs(spreadsheetId)).rejects.toBeInstanceOf(OperationsGoogleSheetsReadError);
    expect(sheetsCallCount).toBe(2);
  });
});
