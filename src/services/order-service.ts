import { changeOrderStatusSchema, createOrderSchema, updateOrderSchema } from "../domain/orders/schema.js";
import { parseInput, uuidSchema } from "../domain/shared.js";
import { OrderRepository } from "../repositories/order-repository.js";
import type { ListOrdersFilter } from "../repositories/types.js";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context.js";

export class OrderService {
  constructor(private readonly dependencies: ServiceDependencies<OrderRepository>) {}
  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  list(filter?: ListOrdersFilter) { return this.dependencies.repository.list(filter); }
  listForCompany(companyId: unknown) { return this.dependencies.repository.listForCompany(parseInput(uuidSchema, companyId)); }

  async create(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.create(parseInput(createOrderSchema, input));
  }

  async update(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.update(
      parseInput(uuidSchema, id),
      parseInput(updateOrderSchema, input),
    );
  }

  async changeStatus(id: unknown, input: unknown, actor: UserMutationActor) {
    const orderId = parseInput(uuidSchema, id);
    const requested = parseInput(changeOrderStatusSchema, input);
    requireVerifiedActor(actor);
    return this.dependencies.repository.changeStatus(orderId, requested.status);
  }

  async assign(id: unknown, profileId: unknown, actor: UserMutationActor) {
    const assignee = parseInput(uuidSchema.nullable(), profileId);
    requireVerifiedActor(actor);
    return this.dependencies.repository.assign(parseInput(uuidSchema, id), assignee);
  }

  async archive(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.archive(parseInput(uuidSchema, id));
  }
}
