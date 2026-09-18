import { parseInput, uuidSchema } from "../domain/shared";
import { ProjectConversationRepository } from "../repositories/project-conversation-repository";
import type { ServiceDependencies } from "./mutation-context";

export class ProjectConversationService {
  constructor(private readonly dependencies: ServiceDependencies<ProjectConversationRepository>) {}

  get(orderId: unknown) {
    return this.dependencies.repository.get(parseInput(uuidSchema, orderId));
  }
}
