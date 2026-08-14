import {
  assignTicketSchema,
  createTicketSchema,
  ticketMessageInputSchema,
  updateTicketPrioritySchema,
  updateTicketStatusSchema,
} from "../domain/tickets/schema";
import { parseInput, uuidSchema } from "../domain/shared";
import { TicketRepository } from "../repositories/ticket-repository";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context";

export class TicketService {
  constructor(private readonly dependencies: ServiceDependencies<TicketRepository>) {}

  list(includeArchived = false) {
    return this.dependencies.repository.list(includeArchived);
  }

  get(id: unknown) {
    return this.dependencies.repository.getById(parseInput(uuidSchema, id));
  }

  create(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.create(parseInput(createTicketSchema, input));
  }

  reply(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.reply(
      parseInput(uuidSchema, id),
      parseInput(ticketMessageInputSchema, input),
    );
  }

  addInternalNote(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.addInternalNote(
      parseInput(uuidSchema, id),
      parseInput(ticketMessageInputSchema, input),
    );
  }

  updateStatus(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.updateStatus(
      parseInput(uuidSchema, id),
      parseInput(updateTicketStatusSchema, input),
    );
  }

  updatePriority(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.updatePriority(
      parseInput(uuidSchema, id),
      parseInput(updateTicketPrioritySchema, input),
    );
  }

  assign(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.assign(
      parseInput(uuidSchema, id),
      parseInput(assignTicketSchema, input),
    );
  }

  archive(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.archive(parseInput(uuidSchema, id));
  }
}
