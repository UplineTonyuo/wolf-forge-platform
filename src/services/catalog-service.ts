import { createServiceSchema, updateServiceSchema } from "../domain/services/schema.js";
import { parseInput, uuidSchema } from "../domain/shared.js";
import { ServiceRepository } from "../repositories/service-repository.js";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context.js";

export class CatalogService {
  constructor(private readonly dependencies: ServiceDependencies<ServiceRepository>) {}
  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  listActive() { return this.dependencies.repository.listActive(); }

  async create(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.create(parseInput(createServiceSchema, input));
  }

  async update(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.update(
      parseInput(uuidSchema, id),
      parseInput(updateServiceSchema, input),
    );
  }

  async archive(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.archive(parseInput(uuidSchema, id));
  }
}
