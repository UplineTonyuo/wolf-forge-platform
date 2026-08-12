import type { SystemActivityInput, UserActivityInput } from "../domain/activity/schema.js";
import type { ActivityEventRow } from "../lib/supabase/database.types.js";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers.js";
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
    );
  }

  async createUserEvent(input: UserActivityInput): Promise<ActivityEventRow> {
    return unwrapOne(await this.client.from("activity_events").insert(input).select().single(), "Activity event");
  }

  async createSystemEvent(input: SystemActivityInput): Promise<ActivityEventRow> {
    return unwrapOne(await this.client.from("activity_events").insert(input).select().single(), "Activity event");
  }
}
