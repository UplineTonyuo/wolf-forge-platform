import {
  activityEntityTypeSchema,
  systemActivitySchema,
  userActivitySchema,
  type SystemActivityInput,
  type UserActivityInput,
} from "../domain/activity/schema.js";
import { parseInput, uuidSchema } from "../domain/shared.js";
import {
  ActivityRepository,
  SystemActivityRepository,
  UserActivityRepository,
} from "../repositories/activity-repository.js";

export class ActivityService {
  constructor(private readonly repository: ActivityRepository) {}

  listTimeline(entityType: unknown, entityId: unknown) {
    return this.repository.listForEntity(
      parseInput(activityEntityTypeSchema, entityType),
      parseInput(uuidSchema, entityId),
    );
  }

}

export class UserActivityService {
  constructor(private readonly repository: UserActivityRepository) {}

  record(input: unknown) {
    return this.repository.create(parseInput(userActivitySchema, input));
  }
}

export class SystemActivityService {
  constructor(private readonly repository: SystemActivityRepository) {}

  record(input: unknown) {
    return this.repository.create(parseInput(systemActivitySchema, input));
  }
}

export type UserActivityWriter = Pick<UserActivityService, "record">;
export type SystemActivityWriter = Pick<SystemActivityService, "record">;
export type { SystemActivityInput, UserActivityInput };
