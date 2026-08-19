import { parseInput } from "../domain/shared";
import {
  recordStoreInterestSchema,
  setInvestmentIntentStatusSchema,
} from "../domain/store-interest/schema";
import type { StoreInterestRepository } from "../repositories/store-interest-repository";
import {
  requireVerifiedActor,
  type ServiceDependencies,
  type UserMutationActor,
} from "./mutation-context";

/**
 * Investment intent orchestration.
 *
 * This service validates shapes and keeps the actor branded as server-verified.
 * It decides no access of its own: which company an interest belongs to, who may
 * read the workspace and who may move a status are all settled inside the
 * database.
 */
export class StoreInterestService {
  constructor(private readonly dependencies: ServiceDependencies<StoreInterestRepository>) {}

  /**
   * Records a cart change as a sales signal.
   *
   * Best effort by design: the caller treats a rejection as a lost telemetry
   * event rather than a failed user action, because the client's cart is local
   * and has already changed by the time this runs.
   */
  record(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.record(parseInput(recordStoreInterestSchema, input));
  }

  list(limit?: number) {
    return this.dependencies.repository.list(limit);
  }

  setStatus(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.setStatus(
      parseInput(setInvestmentIntentStatusSchema, input),
    );
  }
}
