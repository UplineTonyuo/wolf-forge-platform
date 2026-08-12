import { createContactSchema, updateContactSchema } from "../domain/contacts/schema.js";
import { parseInput, uuidSchema } from "../domain/shared.js";
import { ContactRepository } from "../repositories/contact-repository.js";
import { parseMutationContext, type MutationContext, type ServiceDependencies } from "./mutation-context.js";

export class ContactService {
  private readonly now: () => Date;
  constructor(private readonly dependencies: ServiceDependencies<ContactRepository>) {
    this.now = dependencies.now ?? (() => new Date());
  }
  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  listForCompany(companyId: unknown) { return this.dependencies.repository.listForCompany(parseInput(uuidSchema, companyId)); }

  async create(input: unknown, context: MutationContext) {
    const actor = parseMutationContext(context);
    const contact = await this.dependencies.repository.create(parseInput(createContactSchema, input));
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "client_contact", entity_id: contact.id, action: "contact.created", summary: `Created client contact ${contact.name}.`, metadata: { company_id: contact.company_id } });
    return contact;
  }

  async update(id: unknown, input: unknown, context: MutationContext) {
    const actor = parseMutationContext(context);
    const contact = await this.dependencies.repository.update(parseInput(uuidSchema, id), parseInput(updateContactSchema, input));
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "client_contact", entity_id: contact.id, action: "contact.updated", summary: `Updated client contact ${contact.name}.` });
    return contact;
  }

  async archive(id: unknown, context: MutationContext) {
    const actor = parseMutationContext(context);
    const contact = await this.dependencies.repository.archive(parseInput(uuidSchema, id), this.now().toISOString());
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "client_contact", entity_id: contact.id, action: "contact.archived", summary: `Archived client contact ${contact.name}.` });
    return contact;
  }
}
