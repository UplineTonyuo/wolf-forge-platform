import { createServiceSchema, updateServiceSchema } from "../domain/services/schema.js";
import { parseInput, uuidSchema } from "../domain/shared.js";
import { ServiceRepository } from "../repositories/service-repository.js";
import { parseMutationContext, type MutationContext, type ServiceDependencies } from "./mutation-context.js";

export class CatalogService {
  private readonly now: () => Date;
  constructor(private readonly dependencies: ServiceDependencies<ServiceRepository>) {
    this.now = dependencies.now ?? (() => new Date());
  }
  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  listActive() { return this.dependencies.repository.listActive(); }

  async create(input: unknown, context: MutationContext) {
    const actor = parseMutationContext(context);
    const service = await this.dependencies.repository.create(parseInput(createServiceSchema, input));
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "service", entity_id: service.id, action: "service.created", summary: `Created service ${service.name}.` });
    return service;
  }

  async update(id: unknown, input: unknown, context: MutationContext) {
    const actor = parseMutationContext(context);
    const service = await this.dependencies.repository.update(parseInput(uuidSchema, id), parseInput(updateServiceSchema, input));
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "service", entity_id: service.id, action: "service.updated", summary: `Updated service ${service.name}.` });
    return service;
  }

  async archive(id: unknown, context: MutationContext) {
    const actor = parseMutationContext(context);
    const service = await this.dependencies.repository.archive(parseInput(uuidSchema, id), this.now().toISOString());
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "service", entity_id: service.id, action: "service.archived", summary: `Archived service ${service.name}.` });
    return service;
  }
}
