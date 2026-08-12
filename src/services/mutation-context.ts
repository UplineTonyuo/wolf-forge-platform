import { parseInput, uuidSchema } from "../domain/shared.js";
import type { ActivityWriter } from "./activity-service.js";

export interface MutationContext {
  actorProfileId: string;
}

export function parseMutationContext(context: MutationContext): MutationContext {
  return { actorProfileId: parseInput(uuidSchema, context.actorProfileId) };
}

export type ServiceDependencies<Repository> = {
  repository: Repository;
  activity: ActivityWriter;
  now?: () => Date;
};
