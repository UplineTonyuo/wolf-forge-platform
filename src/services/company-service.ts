import { createCompanySchema, updateCompanySchema } from "../domain/companies/schema.js";
import { parseInput, uuidSchema } from "../domain/shared.js";
import { CompanyRepository } from "../repositories/company-repository.js";
import { parseMutationContext, type MutationContext, type ServiceDependencies } from "./mutation-context.js";

export class CompanyService {
  private readonly now: () => Date;
  constructor(private readonly dependencies: ServiceDependencies<CompanyRepository>) {
    this.now = dependencies.now ?? (() => new Date());
  }

  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  listActive() { return this.dependencies.repository.listActive(); }

  async create(input: unknown, context: MutationContext) {
    const actor = parseMutationContext(context);
    const company = await this.dependencies.repository.create(parseInput(createCompanySchema, input));
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "company", entity_id: company.id, action: "company.created", summary: `Created company ${company.name}.` });
    return company;
  }

  async update(id: unknown, input: unknown, context: MutationContext) {
    const companyId = parseInput(uuidSchema, id);
    const actor = parseMutationContext(context);
    const company = await this.dependencies.repository.update(companyId, parseInput(updateCompanySchema, input));
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "company", entity_id: company.id, action: "company.updated", summary: `Updated company ${company.name}.` });
    return company;
  }

  async archive(id: unknown, context: MutationContext) {
    const companyId = parseInput(uuidSchema, id);
    const actor = parseMutationContext(context);
    const company = await this.dependencies.repository.archive(companyId, this.now().toISOString());
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "company", entity_id: company.id, action: "company.archived", summary: `Archived company ${company.name}.` });
    return company;
  }
}
