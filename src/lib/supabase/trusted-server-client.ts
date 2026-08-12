import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ServerEnvironment } from "../env/index.js";
import type { Database } from "./database.types.js";

/** Server-only trust boundary. Never import this factory into browser code. */
export function createTrustedServerSupabaseClient(
  environment: ServerEnvironment,
): SupabaseClient<Database> {
  return createClient<Database>(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
