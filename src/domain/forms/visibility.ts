import { financialIdentity } from "../invoices/visibility";
import type { ClientUser, InternalUser } from "../../lib/supabase/next-server";

export function formsVisibility(user: InternalUser | ClientUser, enabled: boolean, recordIds: string[] = []) {
  return JSON.stringify({ authority: [financialIdentity(user), enabled, user.modules,
    "forms" in user ? user.forms : null,
    "projects" in user ? user.projects : null,
    "tickets" in user ? user.tickets : null], recordIds: [...new Set(recordIds)].sort() });
}

export function formsAccessChanged(previous: string, next: string) {
  const before = JSON.parse(previous) as { authority: unknown; recordIds: string[] };
  const after = JSON.parse(next) as { authority: unknown; recordIds: string[] };
  return JSON.stringify(before.authority) !== JSON.stringify(after.authority)
    || before.recordIds.some((id) => !after.recordIds.includes(id));
}
