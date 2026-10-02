import type { ServiceRow } from "../../lib/supabase/database-rows";

export type FolderSubscriptionState = "all" | "none" | "mixed";

export type EligibilityService = Pick<ServiceRow, "subscription_eligible" | "is_active" | "archived_at">;

/** Derived from the folder's active services; the folder itself stores nothing. */
export function folderSubscriptionSummary(services: EligibilityService[]) {
  const active = services.filter((service) => service.is_active && service.archived_at == null);
  const eligible = active.filter((service) => service.subscription_eligible).length;
  const state: FolderSubscriptionState =
    eligible === 0 ? "none" : eligible === active.length ? "all" : "mixed";
  return { eligible, total: active.length, state };
}
