import "server-only";

import { z } from "zod";
import type { GmailIdentity, GmailTokenSet } from "./google-oauth-client";
import type { IntegrationCredentialStore, ProviderCredentialEnvelope } from "./credential-store";
import type { TrustedServerClient } from "../supabase/trusted-server-client";
import { assertVerifiedActor, type VerifiedActor } from "../supabase/user-client";

const gmailCredentialSchema = z.object({
  provider: z.literal("gmail"),
  version: z.literal(1),
  payload: z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    accessTokenExpiresAt: z.string().datetime(),
    scopes: z.array(z.string().min(1)),
    account: z.object({
      id: z.string().min(1),
      email: z.string().email(),
      displayName: z.string().nullable(),
    }),
  }),
});

export type GmailCredentialEnvelope = z.infer<typeof gmailCredentialSchema>;

export function gmailCredentialEnvelope(tokens: GmailTokenSet, identity: GmailIdentity): GmailCredentialEnvelope {
  if (!tokens.refreshToken) throw new Error("A durable Google refresh authorization is required.");
  return {
    provider: "gmail",
    version: 1,
    payload: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      scopes: [...tokens.scopes],
      account: { id: identity.id, email: identity.email, displayName: identity.displayName },
    },
  };
}

export class GmailVaultCredentialStore implements IntegrationCredentialStore {
  constructor(
    private readonly client: TrustedServerClient,
    private readonly actor: VerifiedActor,
  ) {
    assertVerifiedActor(actor);
  }

  async read(): Promise<GmailCredentialEnvelope | null> {
    const { data, error } = await this.client.rpc("app_server_read_gmail_credentials", { p_actor_id: this.actor.id });
    if (error) throw new Error("Gmail credential retrieval failed.");
    const row = data?.[0];
    if (!row) return null;
    return gmailCredentialSchema.parse(row.credentials);
  }

  async readForAdministration(): Promise<GmailCredentialEnvelope | null> {
    const { data, error } = await this.client.rpc("app_server_read_gmail_credentials_for_administration", { p_actor_id: this.actor.id });
    if (error) throw new Error("Gmail administrative credential retrieval failed.");
    const row = data?.[0];
    if (!row) return null;
    return gmailCredentialSchema.parse(row.credentials);
  }

  async write(credentials: ProviderCredentialEnvelope): Promise<void> {
    const parsed = gmailCredentialSchema.parse(credentials);
    const { error } = await this.client.rpc("app_server_update_gmail_credentials", {
      p_actor_id: this.actor.id,
      p_credentials: parsed,
      p_expires_at: parsed.payload.accessTokenExpiresAt,
    });
    if (error) throw new Error("Gmail credential update failed.");
  }

  async connect(credentials: GmailCredentialEnvelope, identity: GmailIdentity): Promise<void> {
    const parsed = gmailCredentialSchema.parse(credentials);
    const { error } = await this.client.rpc("app_server_store_gmail_connection", {
      p_account_display: identity.displayName ? `${identity.displayName} (${identity.email})` : identity.email,
      p_account_id: identity.id,
      p_actor_id: this.actor.id,
      p_credentials: parsed,
      p_expires_at: parsed.payload.accessTokenExpiresAt,
      p_granted_scopes: parsed.payload.scopes,
    });
    if (error) throw new Error("Gmail credential persistence failed.");
  }

  async delete(): Promise<void> {
    const { error } = await this.client.rpc("app_server_disconnect_gmail", { p_actor_id: this.actor.id });
    if (error) throw new Error("Gmail disconnect persistence failed.");
  }

  async markExpired(): Promise<void> {
    const { error } = await this.client.rpc("app_server_set_gmail_status", {
      p_actor_id: this.actor.id,
      p_status: "expired",
    });
    if (error) throw new Error("Gmail connection status update failed.");
  }

  async markVerified(expiresAt: string): Promise<void> {
    const { error } = await this.client.rpc("app_server_verify_gmail_connection", {
      p_actor_id: this.actor.id,
      p_expires_at: expiresAt,
    });
    if (error) throw new Error("Gmail verification metadata update failed.");
  }
}
