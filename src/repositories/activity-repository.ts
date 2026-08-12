import type { SystemActivityInput, UserActivityInput } from "../domain/activity/schema.js";
import type { ActivityEventRow } from "../lib/supabase/database-rows.js";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers.js";
import type { TrustedServerClient } from "../lib/supabase/trusted-server-client.js";
import type { UserScopedClient } from "../lib/supabase/user-client.js";
import type { DatabaseClient } from "./types.js";

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

/** User-context activity writes can never be backed by a trusted client. */
export class UserActivityRepository {
  constructor(private readonly client: UserScopedClient) {}

  async create(input: UserActivityInput): Promise<ActivityEventRow> {
    return unwrapOne(await this.client.from("activity_events").insert(input).select().single(), "Activity event");
  }
}

/** Intentional server-only capability for actorless/system activity. */
export class SystemActivityRepository {
  constructor(private readonly client: TrustedServerClient) {}

  async create(input: SystemActivityInput): Promise<ActivityEventRow> {
    return unwrapOne(await this.client.from("activity_events").insert(input).select().single(), "Activity event");
  }
}
