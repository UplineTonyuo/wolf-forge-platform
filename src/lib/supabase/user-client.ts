import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PublicEnvironment } from "../env/index.js";
import type { Database } from "./database.types.js";

/** Creates a user-context client whose requests are evaluated by database RLS. */
export function createUserSupabaseClient(
  environment: PublicEnvironment,
  accessToken: string,
): SupabaseClient<Database> {
  return createClient<Database>(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
