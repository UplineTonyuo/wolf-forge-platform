import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ServerEnvironment } from "../env/server-env.js";
import type { Database } from "./database.types.js";

/** Server-only trust boundary. Never import this factory into browser code. */
declare const trustedServerClientBrand: unique symbol;
export type TrustedServerClient = SupabaseClient<Database> & {
  readonly [trustedServerClientBrand]: true;
};

export function createTrustedServerSupabaseClient(
  environment: ServerEnvironment,
): TrustedServerClient {
  if (typeof window !== "undefined") throw new Error("Trusted Supabase clients are server-only.");
  return createClient<Database>(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as TrustedServerClient;
}
