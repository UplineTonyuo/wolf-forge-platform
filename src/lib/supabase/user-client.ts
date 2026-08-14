import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PublicEnvironment } from "../env/index";
import type { Database } from "./database.types";

declare const userScopedClientBrand: unique symbol;
declare const verifiedActorBrand: unique symbol;

export type UserScopedClient = SupabaseClient<Database> & {
  readonly [userScopedClientBrand]: true;
};

export type VerifiedActor = {
  readonly id: string;
  readonly [verifiedActorBrand]: true;
};

const accessTokens = new WeakMap<object, string>();
const verifiedActors = new WeakSet<object>();

/** Creates a user-context client whose requests are evaluated by database RLS. */
export function createUserSupabaseClient(
  environment: PublicEnvironment,
  accessToken: string,
): UserScopedClient {
  const client = createClient<Database>(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  }) as UserScopedClient;
  accessTokens.set(client, accessToken);
  return client;
}

/** Verifies the token with Supabase Auth; decoded claims alone are never trusted. */
export async function verifyActor(client: UserScopedClient): Promise<VerifiedActor> {
  const accessToken = accessTokens.get(client);
  if (!accessToken) throw new Error("User-scoped client has no verification token.");
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Authenticated user verification failed.");
  const actor = Object.freeze({ id: data.user.id }) as VerifiedActor;
  verifiedActors.add(actor);
  return actor;
}

/** Runtime companion to the private type brand; rejects casts/forged objects. */
export function assertVerifiedActor(actor: VerifiedActor): void {
  if (!verifiedActors.has(actor)) throw new Error("A server-verified actor is required.");
}
