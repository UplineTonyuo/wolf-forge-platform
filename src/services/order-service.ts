import { changeOrderStatusSchema, createOrderSchema, orderCompletionPatch, updateOrderSchema } from "../domain/orders/schema.js";
import { parseInput, uuidSchema } from "../domain/shared.js";
import { OrderRepository } from "../repositories/order-repository.js";
import type { ListOrdersFilter } from "../repositories/types.js";
import { parseMutationContext, type MutationContext, type ServiceDependencies } from "./mutation-context.js";

export class OrderService {
  private readonly now: () => Date;
  constructor(private readonly dependencies: ServiceDependencies<OrderRepository>) {
    this.now = dependencies.now ?? (() => new Date());
  }
  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  list(filter?: ListOrdersFilter) { return this.dependencies.repository.list(filter); }
  listForCompany(companyId: unknown) { return this.dependencies.repository.listForCompany(parseInput(uuidSchema, companyId)); }

  async create(input: unknown, context: MutationContext) {
    const actor = parseMutationContext(context);
    const order = await this.dependencies.repository.create(parseInput(createOrderSchema, input));
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "order", entity_id: order.id, action: "order.created", summary: `Created order ${order.order_number}: ${order.title}.`, metadata: { company_id: order.company_id, service_id: order.service_id } });
    return order;
  }

  async update(id: unknown, input: unknown, context: MutationContext) {
    const actor = parseMutationContext(context);
    const order = await this.dependencies.repository.update(parseInput(uuidSchema, id), parseInput(updateOrderSchema, input));
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "order", entity_id: order.id, action: "order.updated", summary: `Updated order ${order.order_number}.` });
    return order;
  }

  async changeStatus(id: unknown, input: unknown, context: MutationContext) {
    const orderId = parseInput(uuidSchema, id);
    const requested = parseInput(changeOrderStatusSchema, input);
    const actor = parseMutationContext(context);
    const previous = await this.dependencies.repository.getById(orderId);
    const order = await this.dependencies.repository.update(orderId, orderCompletionPatch(requested.status, requested.completed_at, this.now));
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "order", entity_id: order.id, action: "order.status_changed", summary: `Changed order ${order.order_number} status from ${previous.status} to ${order.status}.`, metadata: { from: previous.status, to: order.status } });
    return order;
  }

  async assign(id: unknown, profileId: unknown, context: MutationContext) {
    const actor = parseMutationContext(context);
    const assignee = parseInput(uuidSchema.nullable(), profileId);
    const order = await this.dependencies.repository.assign(parseInput(uuidSchema, id), assignee);
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "order", entity_id: order.id, action: "order.assigned", summary: assignee ? `Assigned order ${order.order_number}.` : `Unassigned order ${order.order_number}.`, metadata: { assigned_to_profile_id: assignee } });
    return order;
  }

  async archive(id: unknown, context: MutationContext) {
    const actor = parseMutationContext(context);
    const order = await this.dependencies.repository.archive(parseInput(uuidSchema, id), this.now().toISOString());
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "order", entity_id: order.id, action: "order.archived", summary: `Archived order ${order.order_number}.` });
    return order;
  }
}
