import type { SystemActivityInput } from "../domain/activity/schema";
import type { ActivityEventRow } from "../lib/supabase/database-rows";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers";
import type { TrustedServerClient } from "../lib/supabase/trusted-server-client";
import type { DatabaseClient } from "./types";

export class ActivityRepository {
  constructor(private readonly client: DatabaseClient) {}

  async listForEntity(entityType: ActivityEventRow["entity_type"], entityId: string): Promise<ActivityEventRow[]> {
    return unwrapMany(
      await this.client
        .from("activity_events")
        .select()
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .order("created_at", { ascending: false }),
    ) as ActivityEventRow[];
  }

}

/**
 * Intentional server-only capability for actorless/system activity.
 *
 * There is deliberately no user-scoped counterpart. Browser sessions hold no
 * INSERT privilege on public.activity_events (M-02); every audit row an
 * authenticated action produces is written by the trusted SECURITY DEFINER
 * RPCs and triggers, which derive the actor and timestamp themselves.
 */
export class SystemActivityRepository {
  constructor(private readonly client: TrustedServerClient) {}

  async create(input: SystemActivityInput): Promise<ActivityEventRow> {
    return unwrapOne(await this.client.from("activity_events").insert(input).select().single(), "Activity event");
  }
}
