import { companyNameSchema, createCompanySchema } from "../domain/companies/schema";
import { parseInput, uuidSchema } from "../domain/shared";
import { OrganizationRepository } from "../repositories/organization-repository";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context";

export class OrganizationService {
  constructor(private readonly dependencies: ServiceDependencies<OrganizationRepository>) {}

  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  listActive() { return this.dependencies.repository.listActive(); }
  listMembers(ids: string[]) { return this.dependencies.repository.listMembers(ids); }

  async create(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.create(parseInput(createCompanySchema, input));
  }

  async update(id: unknown, name: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.update(parseInput(uuidSchema, id), parseInput(companyNameSchema, name));
  }

  async addMember(organizationId: unknown, contactId: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.addMember(parseInput(uuidSchema, organizationId), parseInput(uuidSchema, contactId));
  }
}
