import {
  activityEntityTypeSchema,
  systemActivitySchema,
  userActivitySchema,
  type SystemActivityInput,
  type UserActivityInput,
} from "../domain/activity/schema.js";
import { parseInput, uuidSchema } from "../domain/shared.js";
import { ActivityRepository } from "../repositories/activity-repository.js";

export class ActivityService {
  constructor(private readonly repository: ActivityRepository) {}

  listTimeline(entityType: unknown, entityId: unknown) {
    return this.repository.listForEntity(
      parseInput(activityEntityTypeSchema, entityType),
      parseInput(uuidSchema, entityId),
    );
  }

  recordUserAction(input: unknown) {
    return this.repository.createUserEvent(parseInput(userActivitySchema, input));
  }

  recordSystemAction(input: unknown) {
    return this.repository.createSystemEvent(parseInput(systemActivitySchema, input));
  }
}

export type ActivityWriter = Pick<ActivityService, "recordUserAction" | "recordSystemAction">;
export type { SystemActivityInput, UserActivityInput };
