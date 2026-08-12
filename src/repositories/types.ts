import type { Database } from "../lib/supabase/database.types.js";
import type { TrustedServerClient } from "../lib/supabase/trusted-server-client.js";
import type { UserScopedClient } from "../lib/supabase/user-client.js";

export type DatabaseClient = UserScopedClient | TrustedServerClient;
export type UserMutationClient = UserScopedClient;
export interface ListOrdersFilter {
  companyId?: string;
  status?: Database["public"]["Tables"]["orders"]["Row"]["status"];
  includeArchived?: boolean;
}
