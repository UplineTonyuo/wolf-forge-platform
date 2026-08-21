import {
  activityEntityTypeSchema,
  systemActivitySchema,
  type SystemActivityInput,
} from "../domain/activity/schema";
import { parseInput, uuidSchema } from "../domain/shared";
import { ActivityRepository, SystemActivityRepository } from "../repositories/activity-repository";

export class ActivityService {
  constructor(private readonly repository: ActivityRepository) {}

  listTimeline(entityType: unknown, entityId: unknown) {
    return this.repository.listForEntity(
      parseInput(activityEntityTypeSchema, entityType),
      parseInput(uuidSchema, entityId),
    );
  }

}

export class SystemActivityService {
  constructor(private readonly repository: SystemActivityRepository) {}

  record(input: unknown) {
    return this.repository.create(parseInput(systemActivitySchema, input));
  }
}

export type SystemActivityWriter = Pick<SystemActivityService, "record">;
export type { SystemActivityInput };
