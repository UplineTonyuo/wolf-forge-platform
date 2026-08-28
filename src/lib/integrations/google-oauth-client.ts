import "server-only";

import { z } from "zod";
import { GMAIL_OAUTH_SCOPES, hasExactGmailScopes } from "../../domain/integrations/gmail";
import type { GoogleOAuthEnvironment } from "../env/google-oauth-env";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOCATION_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL_SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

const userInfoSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean(),
  name: z.string().trim().min(1).optional(),
});

export type GmailIdentity = { id: string; email: string; displayName: string | null };
export type GmailTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: string;
  scopes: readonly string[];
};

export class GmailReauthorizationRequiredError extends Error {
  constructor() { super("Gmail authorization must be renewed."); }
}

export class GoogleOAuthClient {
  constructor(
    private readonly environment: GoogleOAuthEnvironment,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  buildAuthorizationUrl(state: string, codeChallenge: string): URL {
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.environment.GOOGLE_CLIENT_ID,
      redirect_uri: this.environment.GOOGLE_OAUTH_REDIRECT_URI,
      response_type: "code",
      scope: GMAIL_OAUTH_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return url;
  }

  async exchangeCode(code: string, verifier: string): Promise<GmailTokenSet> {
    const response = await this.fetcher(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.environment.GOOGLE_CLIENT_ID,
        client_secret: this.environment.GOOGLE_CLIENT_SECRET,
        redirect_uri: this.environment.GOOGLE_OAUTH_REDIRECT_URI,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Google authorization code exchange failed.");
    const parsed = tokenResponseSchema.parse(await response.json());
    const scopes = parseScopes(parsed.scope);
    if (!parsed.refresh_token || !hasExactGmailScopes(scopes)) {
      throw new Error("Google did not grant the required Gmail send-only authorization.");
    }
    return toTokenSet(parsed, scopes);
  }

  async refresh(refreshToken: string, existingScopes: readonly string[]): Promise<GmailTokenSet> {
    const response = await this.fetcher(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.environment.GOOGLE_CLIENT_ID,
        client_secret: this.environment.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as { error?: unknown } | null;
      if (errorBody?.error === "invalid_grant") throw new GmailReauthorizationRequiredError();
      throw new Error("Google access token refresh failed.");
    }
    const parsed = tokenResponseSchema.parse(await response.json());
    const scopes = parsed.scope ? parseScopes(parsed.scope) : [...existingScopes];
    if (!hasExactGmailScopes(scopes)) throw new GmailReauthorizationRequiredError();
    return toTokenSet(parsed, scopes);
  }

  async readIdentity(accessToken: string): Promise<GmailIdentity> {
    const response = await this.fetcher(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) throw new GmailReauthorizationRequiredError();
    if (!response.ok) throw new Error("Google account identity verification failed.");
    const identity = userInfoSchema.parse(await response.json());
    if (!identity.email_verified) throw new Error("Google account email is not verified.");
    return { id: identity.sub, email: identity.email, displayName: identity.name ?? null };
  }

  async revoke(token: string): Promise<void> {
    const response = await this.fetcher(REVOCATION_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      cache: "no-store",
    });
    if (!response.ok && response.status !== 400) throw new Error("Google credential revocation failed.");
  }

  async send(accessToken: string, message: { to: string; subject: string; text: string }): Promise<string> {
    z.string().email().parse(message.to);
    assertMailHeader(message.to);
    assertMailHeader(message.subject);
    const raw = Buffer.from([
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      message.text,
    ].join("\r\n"), "utf8").toString("base64url");
    const response = await this.fetcher(GMAIL_SEND_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ raw }),
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) throw new GmailReauthorizationRequiredError();
    if (!response.ok) throw new Error("Gmail message delivery failed.");
    const result = z.object({ id: z.string().min(1) }).parse(await response.json());
    return result.id;
  }
}

function parseScopes(value: string | undefined): string[] {
  return value?.split(/\s+/u).filter(Boolean) ?? [];
}

function toTokenSet(parsed: z.infer<typeof tokenResponseSchema>, scopes: readonly string[]): GmailTokenSet {
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null,
    accessTokenExpiresAt: new Date(Date.now() + parsed.expires_in * 1000).toISOString(),
    scopes,
  };
}

function assertMailHeader(value: string): void {
  if (!value.trim() || /[\r\n]/u.test(value)) throw new Error("Gmail message headers are invalid.");
}
