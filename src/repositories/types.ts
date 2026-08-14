import type { Database } from "../lib/supabase/database.types";
import type { TrustedServerClient } from "../lib/supabase/trusted-server-client";
import type { UserScopedClient } from "../lib/supabase/user-client";

export type DatabaseClient = UserScopedClient | TrustedServerClient;
export type UserMutationClient = UserScopedClient;
export interface ListOrdersFilter {
  companyId?: string;
  serviceId?: string;
  assignedToProfileId?: string;
  status?: Database["public"]["Tables"]["orders"]["Row"]["status"];
  includeArchived?: boolean;
}
