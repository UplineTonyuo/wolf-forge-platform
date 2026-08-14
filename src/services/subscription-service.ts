import {
  cancelSubscriptionSchema,
  createSubscriptionSchema,
  pauseSubscriptionSchema,
  updateSubscriptionTermsSchema,
} from "../domain/subscriptions/schema";
import { parseInput, uuidSchema } from "../domain/shared";
import { SubscriptionRepository } from "../repositories/subscription-repository";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context";

export class SubscriptionService {
  constructor(private readonly dependencies: ServiceDependencies<SubscriptionRepository>) {}

  list() { return this.dependencies.repository.list(); }
  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  listDueWork(limit = 100) { return this.dependencies.repository.listDueWork(limit); }

  create(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.create(parseInput(createSubscriptionSchema, input));
  }

  updateTerms(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.updateTerms(
      parseInput(uuidSchema, id), parseInput(updateSubscriptionTermsSchema, input),
    );
  }

  generateCycleInvoice(cycleId: unknown, requestId: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.generateCycleInvoice(
      parseInput(uuidSchema, cycleId), parseInput(uuidSchema, requestId),
    );
  }

  reconcile(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.reconcile(parseInput(uuidSchema, id));
  }

  pause(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.pause(
      parseInput(uuidSchema, id), parseInput(pauseSubscriptionSchema, input),
    );
  }

  resume(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.resume(parseInput(uuidSchema, id));
  }

  scheduleCancellation(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.scheduleCancellation(
      parseInput(uuidSchema, id), parseInput(cancelSubscriptionSchema, input),
    );
  }

  removeCancellation(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.removeCancellation(parseInput(uuidSchema, id));
  }

  cancel(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.cancel(
      parseInput(uuidSchema, id), parseInput(cancelSubscriptionSchema, input),
    );
  }
}
