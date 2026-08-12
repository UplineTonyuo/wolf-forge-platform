import { createContactSchema, updateContactSchema } from "../domain/contacts/schema.js";
import { parseInput, uuidSchema } from "../domain/shared.js";
import { ContactRepository } from "../repositories/contact-repository.js";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context.js";

export class ContactService {
  constructor(private readonly dependencies: ServiceDependencies<ContactRepository>) {}
  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  listForCompany(companyId: unknown) { return this.dependencies.repository.listForCompany(parseInput(uuidSchema, companyId)); }

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
