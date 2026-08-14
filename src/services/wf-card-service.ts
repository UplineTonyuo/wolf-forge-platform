import { payInvoiceWithWfCardSchema } from "../domain/wf-card/schema";
import { parseInput, uuidSchema } from "../domain/shared";
import { WfCardRepository } from "../repositories/wf-card-repository";
import {
  requireVerifiedActor,
  type ServiceDependencies,
  type UserMutationActor,
} from "./mutation-context";

export class WfCardService {
  constructor(
    private readonly dependencies: ServiceDependencies<WfCardRepository>,
  ) {}

  getMembership(companyId: unknown) {
    return this.dependencies.repository.getMembership(parseInput(uuidSchema, companyId));
  }

  getOffer() {
    return this.dependencies.repository.getOffer();
  }

  payInvoice(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.payInvoice(parseInput(payInvoiceWithWfCardSchema, input));
  }
}
