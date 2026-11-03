import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PublicEnvironment } from "../env/index";
import type { Database } from "./database.types";
import { TENANT_SELECTOR_HEADER, type TenantSelector } from "../../domain/tenancy/tenant-selector";
import { identityLookup, IdentityLookupError } from "./identity-lookup";
import { CLIENT_SUPPORT_HEADER, clientSupportProofSchema, clientSupportTokenSchema, type ClientSupportProof } from "../../domain/auth/client-support";
import { clientSupportFetch } from "./client-support-fetch";

declare const userScopedClientBrand: unique symbol;
declare const verifiedActorBrand: unique symbol;

export type UserScopedClient = SupabaseClient<Database> & {
  readonly [userScopedClientBrand]: true;
};

export type VerifiedActor = {
  readonly id: string;
  /** The verified token's email claim; null when absent. */
  readonly email: string | null;
  readonly support?: ClientSupportProof;
  readonly [verifiedActorBrand]: true;
};

const accessTokens = new WeakMap<object, string>();
const verifiedActors = new WeakSet<object>();
const supportContexts = new WeakMap<object, { token: string; tenant: TenantSelector }>();

/**
 * Creates a user-context client whose requests are evaluated by database RLS.
 * An optional server-resolved Tenant selector is sent as `x-wf-tenant`; the
 * database still authorizes it against the user's membership.
 */
export function createUserSupabaseClient(
  environment: PublicEnvironment,
  accessToken: string,
  tenantSelector?: TenantSelector,
  supportToken?: string,
): UserScopedClient {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (tenantSelector) headers[TENANT_SELECTOR_HEADER] = tenantSelector;
  if (supportToken) {
    if (!tenantSelector || !clientSupportTokenSchema.safeParse(supportToken).success) throw new Error("Client support is unavailable.");
    headers[CLIENT_SUPPORT_HEADER] = supportToken;
  }

  const client = createClient<Database>(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers,
      ...(supportToken ? { fetch: clientSupportFetch(environment.SUPABASE_URL) } : {}),
    },
  }) as UserScopedClient;
  accessTokens.set(client, accessToken);
  if (supportToken && tenantSelector) supportContexts.set(client, { token: supportToken, tenant: tenantSelector });
  return client;
}

/**
 * Cryptographically verifies the user's access token before creating a
 * VerifiedActor. getClaims() avoids the Auth user-record network request when
 * the project uses asymmetric JWT signing while still rejecting invalid or
 * expired tokens.
 */
export async function verifyActor(client: UserScopedClient): Promise<VerifiedActor> {
  const accessToken = accessTokens.get(client);
  if (!accessToken) throw new Error("User-scoped client has no verification token.");

  const { data } = await identityLookup(() => client.auth.getClaims(accessToken), "claims");
  const subject = data?.claims?.sub;

  if (typeof subject !== "string" || subject.length === 0) {
    throw new IdentityLookupError("unauthenticated", "claims");
  }

  const email = typeof data?.claims.email === "string" && data.claims.email ? data.claims.email : null;
  const supportContext = supportContexts.get(client);
  let support: ClientSupportProof | undefined;
  if (supportContext) {
    const result = await client.rpc("app_get_client_support_context");
    const parsed = clientSupportProofSchema.safeParse(result.data);
    if (result.error || !parsed.success || parsed.data.administratorId !== subject ||
      parsed.data.tenantId !== supportContext.tenant || parsed.data.id !== supportContext.token.split(".")[0] ||
      Date.parse(parsed.data.expiresAt) <= Date.now()) throw new IdentityLookupError("unauthorized", "membership");
    support = Object.freeze(parsed.data);
  }
  const actor = Object.freeze(support ? { id: support.clientId, email: support.email, support } : { id: subject, email }) as VerifiedActor;
  verifiedActors.add(actor);
  return actor;
}

/** Runtime companion to the private type brand; rejects casts/forged objects. */
export function assertVerifiedActor(actor: VerifiedActor): void {
  if (!verifiedActors.has(actor)) throw new Error("A server-verified actor is required.");
}

/** Authenticate a server-side event bridge without returning its bearer token. */
export async function authenticateUserRealtime(client: UserScopedClient): Promise<number> {
  const token = accessTokens.get(client);
  if (!token) throw new Error("Missing verified session.");
  const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as { exp?: number };
  const ttl = Math.min(240_000, (claims.exp ?? 0) * 1000 - Date.now() - 5000);
  if (ttl < 10_000) throw new Error("Session renewal required.");
  // This client has no browser Auth session; otherwise heartbeat falls back to the public key.
  client.realtime.accessToken = async () => token;
  await client.realtime.setAuth(token);
  return ttl;
}
