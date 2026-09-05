import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GMAIL_OAUTH_SCOPES } from "../domain/integrations/gmail";
import { GMAIL_OAUTH_CALLBACK_PATH, readGoogleOAuthEnvironment } from "../lib/env/google-oauth-env";
import { GoogleOAuthClient, GmailReauthorizationRequiredError } from "../lib/integrations/google-oauth-client";
import { INTEGRATION_PROVIDER_ADAPTERS } from "../lib/integrations/provider-adapters";
import { createOAuthState, createPkcePair, validateGmailCallback } from "../lib/integrations/oauth-state";
import { requireIntegrationManager } from "../lib/integrations/gmail-route-security";
import { requestHasExpectedOrigin } from "../lib/security/same-origin";
import { GmailIntegrationService, type GmailCredentialPersistence, type GmailProviderPort } from "../services/gmail-integration-service";
import type { GmailCredentialEnvelope } from "../lib/integrations/gmail-credential-store";

const environment = readGoogleOAuthEnvironment({
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret", // secret-scan:allow(non-issued OAuth test fixture); gitleaks:allow
  GOOGLE_OAUTH_REDIRECT_URI: `http://127.0.0.1:3000${GMAIL_OAUTH_CALLBACK_PATH}`,
});

const identity = { id: "google-subject", email: "owner@example.com", displayName: "Owner" };
const tokenSet = {
  accessToken: "server-access-token",
  refreshToken: "server-refresh-token",
  accessTokenExpiresAt: "2026-08-25T14:00:00.000Z",
  scopes: [...GMAIL_OAUTH_SCOPES],
};
const credential: GmailCredentialEnvelope = {
  provider: "gmail",
  version: 1,
  payload: { ...tokenSet, refreshToken: "server-refresh-token", account: identity },
};

function provider(overrides: Partial<GmailProviderPort> = {}): GmailProviderPort {
  return {
    buildAuthorizationUrl: vi.fn(() => new URL("https://accounts.google.com/o/oauth2/v2/auth")),
    exchangeCode: vi.fn(async () => tokenSet),
    refresh: vi.fn(async () => tokenSet),
    readIdentity: vi.fn(async () => identity),
    revoke: vi.fn(async () => undefined),
    send: vi.fn(async () => "message-id"),
    ...overrides,
  };
}

function store(overrides: Partial<GmailCredentialPersistence> = {}): GmailCredentialPersistence {
  return {
    read: vi.fn(async () => credential),
    readForAdministration: vi.fn(async () => credential),
    write: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    markExpired: vi.fn(async () => undefined),
    markVerified: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

describe("Gmail OAuth boundary", () => {
  it("registers Gmail as the only live provider adapter", () => {
    expect(INTEGRATION_PROVIDER_ADAPTERS.gmail).toMatchObject({ implementationStatus: "live", supportsConnect: true, supportsDisconnect: true, supportsSend: true });
    expect(INTEGRATION_PROVIDER_ADAPTERS.stripe.implementationStatus).toBe("foundation");
    expect(INTEGRATION_PROVIDER_ADAPTERS.paypal.implementationStatus).toBe("foundation");
  });

  it("requires integrations.manage before a connect action", () => {
    expect(() => requireIntegrationManager(false)).toThrow(/not permitted/i);
    expect(() => requireIntegrationManager(true)).not.toThrow();
  });

  it("uses the exact configured redirect, PKCE, and approved minimum scope set", () => {
    const client = new GoogleOAuthClient(environment);
    const url = client.buildAuthorizationUrl("state-value", "pkce-challenge");
    expect(url.searchParams.get("redirect_uri")).toBe(environment.GOOGLE_OAUTH_REDIRECT_URI);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...GMAIL_OAUTH_SCOPES]);
    expect(url.searchParams.get("scope")).not.toMatch(/gmail\.readonly|gmail\.modify|mail\.google\.com|gmail\.metadata/u);
  });

  it("generates strong state and PKCE values", () => {
    const first = createOAuthState();
    const second = createOAuthState();
    const pair = createPkcePair();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge).not.toBe(pair.verifier);
  });

  it("rejects missing or mismatched state and handles a provider error safely", () => {
    expect(validateGmailCallback({ expectedState: undefined, receivedState: null, verifier: undefined, code: null, providerError: false })).toEqual({ ok: false, result: "state-error" });
    expect(validateGmailCallback({ expectedState: "expected", receivedState: "other", verifier: "verifier", code: "code", providerError: false })).toEqual({ ok: false, result: "state-error" });
    expect(validateGmailCallback({ expectedState: "same", receivedState: "same", verifier: "verifier", code: null, providerError: true })).toEqual({ ok: false, result: "provider-error" });
  });

  it("accepts only same-origin mutation requests", () => {
    expect(requestHasExpectedOrigin(new Request("http://127.0.0.1:3000", { headers: { origin: "http://127.0.0.1:3000" } }), environment.GOOGLE_OAUTH_REDIRECT_URI)).toBe(true);
    expect(requestHasExpectedOrigin(new Request("http://127.0.0.1:3000", { headers: { origin: "https://evil.example" } }), environment.GOOGLE_OAUTH_REDIRECT_URI)).toBe(false);
    expect(requestHasExpectedOrigin(new Request("http://127.0.0.1:3000"), environment.GOOGLE_OAUTH_REDIRECT_URI)).toBe(false);
  });

  it("exchanges the authorization code server-side and never puts the client secret in the URL", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({
        access_token: "server-access-token",
        refresh_token: "server-refresh-token",
        expires_in: 3600,
        scope: GMAIL_OAUTH_SCOPES.join(" "),
        token_type: "Bearer",
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = new GoogleOAuthClient(environment, fetcher as typeof fetch);
    await client.exchangeCode("authorization-code", "pkce-verifier");
    const [input, init] = fetcher.mock.calls[0]!;
    expect(String(input)).toBe("https://oauth2.googleapis.com/token");
    expect(String(input)).not.toContain(environment.GOOGLE_CLIENT_SECRET);
    expect(String(init?.body)).toContain("client_secret=google-client-secret");
  });
});

describe("Gmail connection lifecycle", () => {
  it("does not claim Connected when encrypted credential persistence fails", async () => {
    const google = provider();
    const persistence = store({ connect: vi.fn(async () => { throw new Error("vault unavailable"); }) });
    await expect(new GmailIntegrationService(google, persistence).completeAuthorization("code", "verifier")).rejects.toThrow(/vault unavailable/u);
    expect(persistence.connect).toHaveBeenCalledOnce();
    expect(google.revoke).toHaveBeenCalledWith("server-refresh-token");
  });

  it("refreshes an expired access token and persists it before verification", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T14:10:00.000Z"));
    const google = provider({ refresh: vi.fn(async () => ({ ...tokenSet, accessToken: "refreshed-access-token", refreshToken: null, accessTokenExpiresAt: "2026-08-25T15:10:00.000Z" })) });
    const persistence = store();
    await new GmailIntegrationService(google, persistence).verify();
    expect(google.refresh).toHaveBeenCalledWith("server-refresh-token", [...GMAIL_OAUTH_SCOPES]);
    expect(persistence.write).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ accessToken: "refreshed-access-token", refreshToken: "server-refresh-token" }) }));
    expect(persistence.markVerified).toHaveBeenCalledWith("2026-08-25T15:10:00.000Z");
  });

  it("marks the connection expired when Google rejects the refresh token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T14:10:00.000Z"));
    const google = provider({ refresh: vi.fn(async () => { throw new GmailReauthorizationRequiredError(); }) });
    const persistence = store();
    await expect(new GmailIntegrationService(google, persistence).verify()).rejects.toBeInstanceOf(GmailReauthorizationRequiredError);
    expect(persistence.markExpired).toHaveBeenCalledOnce();
  });

  it("marks the connection expired when Gmail rejects an otherwise current access token", async () => {
    const google = provider({ send: vi.fn(async () => { throw new GmailReauthorizationRequiredError(); }) });
    const persistence = store();
    await expect(new GmailIntegrationService(google, persistence).send({ to: "qa@example.com", subject: "Connection test", text: "No client delivery." })).rejects.toBeInstanceOf(GmailReauthorizationRequiredError);
    expect(persistence.markExpired).toHaveBeenCalledOnce();
  });

  it("revokes Google authorization and destroys the local credential reference on disconnect", async () => {
    const google = provider();
    const persistence = store();
    await new GmailIntegrationService(google, persistence).disconnect();
    expect(google.revoke).toHaveBeenCalledWith("server-refresh-token");
    expect(persistence.delete).toHaveBeenCalledOnce();
  });

  it("keeps credentials out of the browser DTO and contains no token/code logging", () => {
    const schemaSource = readFileSync(join(process.cwd(), "src/domain/integrations/schema.ts"), "utf8");
    const sources = [
      "src/services/gmail-integration-service.ts",
      "src/lib/integrations/google-oauth-client.ts",
      "src/app/(internal)/settings/integrations/gmail/callback/route.ts",
    ].map((file) => readFileSync(join(process.cwd(), file), "utf8")).join("\n");
    expect(schemaSource).not.toMatch(/accessToken|refreshToken|clientSecret|authorizationCode/u);
    expect(sources).not.toMatch(/console\.(log|info|warn|error|debug)/u);
  });
});
