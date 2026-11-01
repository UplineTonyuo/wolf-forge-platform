import { z } from "zod";
import { goalSchema, goalListSchema, goalMemberSchema, type GoalInput, type GoalVisibility } from "../domain/goals/schema";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type { Json } from "../lib/supabase/database.types";
import type { UserMutationClient } from "./types";

const photoContextSchema = z.object({
  tenant_id: z.uuid(), updated_at: z.string(), photo_path: z.string().nullable(),
  photo_mime: z.string().nullable(), photo_size: z.number().nullable(), photo_checksum: z.string().nullable(),
});
export class GoalRepository {
  constructor(private readonly client: UserMutationClient) {}
  async list(before: string | null = null, visibility: GoalVisibility | null = null) {
    const result = await this.client.rpc("app_list_team_goals", { p_before: before ?? undefined, p_visibility: visibility ?? undefined });
    if (result.error) throw mapDatabaseError(result.error, "Goals");
    return goalListSchema.parse(result.data);
  }
  async get(id: string) {
    const result = await this.client.rpc("app_get_team_goal", { p_goal_id: id });
    if (result.error) throw mapDatabaseError(result.error, "Goal");
    return goalSchema.parse(result.data);
  }
  async members() {
    const result = await this.client.rpc("app_team_goal_members");
    if (result.error) throw mapDatabaseError(result.error, "Goal owners");
    return z.array(goalMemberSchema).parse(result.data);
  }
  async save(id: string | null, input: GoalInput, revision: string | null) {
    const result = await this.client.rpc("app_save_team_goal", {
      p_goal_id: id, p_input: input as unknown as Json, p_expected_updated_at: revision ?? undefined,
    });
    if (result.error) throw mapDatabaseError(result.error, "Goal");
    return goalSchema.parse(result.data);
  }
  async complete(id: string, milestoneId: string, completed: boolean) {
    const result = await this.client.rpc("app_set_team_goal_milestone", { p_goal_id: id, p_milestone_id: milestoneId, p_completed: completed });
    if (result.error) throw mapDatabaseError(result.error, "Milestone");
    return goalSchema.parse(result.data);
  }
  async photoContext(id: string, write = false) {
    const result = await this.client.rpc("app_team_goal_photo_context", { p_goal_id: id, p_write: write });
    if (result.error) throw mapDatabaseError(result.error, "Goal photo");
    return photoContextSchema.parse(result.data);
  }
  async setPhoto(id: string, input: { path: string; mime: string; size: number; checksum: string; revision: string }) {
    const result = await this.client.rpc("app_set_team_goal_photo", {
      p_goal_id: id, p_path: input.path, p_mime: input.mime, p_size: input.size,
      p_checksum: input.checksum, p_expected_updated_at: input.revision,
    });
    if (result.error) throw mapDatabaseError(result.error, "Goal photo");
    return goalSchema.parse(result.data);
  }
}
