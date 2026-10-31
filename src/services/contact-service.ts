import { createContactSchema, updateContactSchema } from "../domain/contacts/schema";
import { parseInput, uuidSchema } from "../domain/shared";
import { ContactRepository } from "../repositories/contact-repository";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context";

export class ContactService {
  constructor(private readonly dependencies: ServiceDependencies<ContactRepository>) {}
  getPrimarySummary(companyId: unknown) { return this.dependencies.repository.getPrimarySummary(parseInput(uuidSchema, companyId)); }
  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  listForCompany(companyId: unknown) { return this.dependencies.repository.listForCompany(parseInput(uuidSchema, companyId)); }
  listForCompanies(companyIds: unknown[]) { return this.dependencies.repository.listForCompanies(companyIds.map((id) => parseInput(uuidSchema, id))); }

  async create(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.create(parseInput(createContactSchema, input));
  }

  async update(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.update(
      parseInput(uuidSchema, id),
      parseInput(updateContactSchema, input),
    );
  }

  async archive(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.archive(parseInput(uuidSchema, id));
  }
}
