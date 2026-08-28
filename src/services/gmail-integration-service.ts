import "server-only";

import { GmailReauthorizationRequiredError } from "../lib/integrations/google-oauth-client";
import {
  gmailCredentialEnvelope,
  type GmailCredentialEnvelope,
} from "../lib/integrations/gmail-credential-store";
import type { GmailIdentity, GmailTokenSet } from "../lib/integrations/google-oauth-client";

const REFRESH_EARLY_MILLISECONDS = 60_000;

export interface GmailProviderPort {
  buildAuthorizationUrl(state: string, codeChallenge: string): URL;
  exchangeCode(code: string, verifier: string): Promise<GmailTokenSet>;
  refresh(refreshToken: string, existingScopes: readonly string[]): Promise<GmailTokenSet>;
  readIdentity(accessToken: string): Promise<GmailIdentity>;
  revoke(token: string): Promise<void>;
  send(accessToken: string, message: { to: string; subject: string; text: string }): Promise<string>;
}

export interface GmailCredentialPersistence {
  read(): Promise<GmailCredentialEnvelope | null>;
  readForAdministration(): Promise<GmailCredentialEnvelope | null>;
  write(credentials: GmailCredentialEnvelope): Promise<void>;
  connect(credentials: GmailCredentialEnvelope, identity: GmailIdentity): Promise<void>;
  delete(): Promise<void>;
  markExpired(): Promise<void>;
  markVerified(expiresAt: string): Promise<void>;
}

export class GmailIntegrationService {
  constructor(
    private readonly google: GmailProviderPort,
    private readonly credentials: GmailCredentialPersistence,
  ) {}

  authorizationUrl(state: string, challenge: string): URL {
    return this.google.buildAuthorizationUrl(state, challenge);
  }

  async completeAuthorization(code: string, verifier: string): Promise<void> {
    const tokens = await this.google.exchangeCode(code, verifier);
    const identity = await this.google.readIdentity(tokens.accessToken);
    const envelope = gmailCredentialEnvelope(tokens, identity);
    const previous = await this.credentials.readForAdministration();
    try {
      await this.credentials.connect(envelope, identity);
      if (previous) await this.google.revoke(previous.payload.refreshToken).catch(() => undefined);
    } catch (error) {
      await this.google.revoke(envelope.payload.refreshToken).catch(() => undefined);
      throw error;
    }
  }

  async verify(): Promise<void> {
    const credential = await this.validCredential();
    let identity;
    try {
      identity = await this.google.readIdentity(credential.payload.accessToken);
    } catch (error) {
      if (error instanceof GmailReauthorizationRequiredError) await this.credentials.markExpired();
      throw error;
    }
    if (identity.id !== credential.payload.account.id || identity.email !== credential.payload.account.email) {
      await this.credentials.markExpired();
      throw new GmailReauthorizationRequiredError();
    }
    await this.credentials.markVerified(credential.payload.accessTokenExpiresAt);
  }

  async disconnect(): Promise<void> {
    const credential = await this.credentials.readForAdministration();
    if (credential) {
      await this.google.revoke(credential.payload.refreshToken).catch(() => undefined);
    }
    await this.credentials.delete();
  }

  async send(message: { to: string; subject: string; text: string }): Promise<string> {
    const credential = await this.validCredential();
    try {
      return await this.google.send(credential.payload.accessToken, message);
    } catch (error) {
      if (error instanceof GmailReauthorizationRequiredError) await this.credentials.markExpired();
      throw error;
    }
  }

  private async validCredential(): Promise<GmailCredentialEnvelope> {
    const current = await this.credentials.read();
    if (!current) throw new GmailReauthorizationRequiredError();
    const expiresAt = new Date(current.payload.accessTokenExpiresAt).valueOf();
    if (expiresAt > Date.now() + REFRESH_EARLY_MILLISECONDS) return current;

    try {
      const refreshed = await this.google.refresh(current.payload.refreshToken, current.payload.scopes);
      const next: GmailCredentialEnvelope = {
        ...current,
        payload: {
          ...current.payload,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? current.payload.refreshToken,
          accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
          scopes: [...refreshed.scopes],
        },
      };
      await this.credentials.write(next);
      return next;
    } catch (error) {
      if (error instanceof GmailReauthorizationRequiredError) await this.credentials.markExpired();
      throw error;
    }
  }
}
