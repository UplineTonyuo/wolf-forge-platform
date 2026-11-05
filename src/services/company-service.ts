import { createCompanySchema, updateCompanySchema } from "../domain/companies/schema";
import { parseInput, uuidSchema } from "../domain/shared";
import { CompanyRepository } from "../repositories/company-repository";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context";

export class CompanyService {
  constructor(private readonly dependencies: ServiceDependencies<CompanyRepository>) {}

  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  listActive() { return this.dependencies.repository.listActive(); }
  managerOptions() { return this.dependencies.repository.managerOptions(); }
  managerAssignments() { return this.dependencies.repository.managerAssignments(); }
  assignManager(id: unknown, managerId: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.assignManager(parseInput(uuidSchema, id), parseInput(uuidSchema, managerId));
  }

  async create(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.create(parseInput(createCompanySchema, input));
  }

  async update(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.update(
      parseInput(uuidSchema, id),
      parseInput(updateCompanySchema, input),
    );
  }

  async archive(id: unknown, actor: UserMutationActor) {
    const companyId = parseInput(uuidSchema, id);
    requireVerifiedActor(actor);
    return this.dependencies.repository.archive(companyId);
  }
}
