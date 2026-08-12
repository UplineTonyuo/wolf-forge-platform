import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.js";

export type DatabaseClient = SupabaseClient<Database>;
export interface ListOrdersFilter {
  companyId?: string;
  status?: Database["public"]["Tables"]["orders"]["Row"]["status"];
  includeArchived?: boolean;
}
