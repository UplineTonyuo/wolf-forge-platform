import { changeTaskStatusSchema, createTaskSchema, reorderTaskSchema, taskCompletionPatch, updateTaskSchema } from "../domain/tasks/schema.js";
import { parseInput, uuidSchema } from "../domain/shared.js";
import { TaskRepository } from "../repositories/task-repository.js";
import { parseMutationContext, type MutationContext, type ServiceDependencies } from "./mutation-context.js";

export class TaskService {
  private readonly now: () => Date;
  constructor(private readonly dependencies: ServiceDependencies<TaskRepository>) {
    this.now = dependencies.now ?? (() => new Date());
  }
  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  listForOrder(orderId: unknown) { return this.dependencies.repository.listForOrder(parseInput(uuidSchema, orderId)); }

  async create(input: unknown, context: MutationContext) {
    const actor = parseMutationContext(context);
    const task = await this.dependencies.repository.create(parseInput(createTaskSchema, input));
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "order_task", entity_id: task.id, action: "task.created", summary: `Created order task ${task.title}.`, metadata: { order_id: task.order_id } });
    return task;
  }

  async update(id: unknown, input: unknown, context: MutationContext) {
    const actor = parseMutationContext(context);
    const task = await this.dependencies.repository.update(parseInput(uuidSchema, id), parseInput(updateTaskSchema, input));
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "order_task", entity_id: task.id, action: "task.updated", summary: `Updated order task ${task.title}.` });
    return task;
  }

  async changeStatus(id: unknown, input: unknown, context: MutationContext) {
    const taskId = parseInput(uuidSchema, id);
    const requested = parseInput(changeTaskStatusSchema, input);
    const actor = parseMutationContext(context);
    const previous = await this.dependencies.repository.getById(taskId);
    const task = await this.dependencies.repository.update(taskId, taskCompletionPatch(requested.status, requested.completed_at, this.now));
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "order_task", entity_id: task.id, action: "task.status_changed", summary: `Changed task status from ${previous.status} to ${task.status}.`, metadata: { from: previous.status, to: task.status } });
    return task;
  }

  async assign(id: unknown, profileId: unknown, context: MutationContext) {
    const actor = parseMutationContext(context);
    const assignee = parseInput(uuidSchema.nullable(), profileId);
    const task = await this.dependencies.repository.assign(parseInput(uuidSchema, id), assignee);
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "order_task", entity_id: task.id, action: "task.assigned", summary: assignee ? `Assigned order task ${task.title}.` : `Unassigned order task ${task.title}.`, metadata: { assigned_to_profile_id: assignee } });
    return task;
  }

  async reorder(id: unknown, input: unknown, context: MutationContext) {
    const actor = parseMutationContext(context);
    const { sort_position } = parseInput(reorderTaskSchema, input);
    const task = await this.dependencies.repository.reorder(parseInput(uuidSchema, id), sort_position);
    await this.dependencies.activity.recordUserAction({ actor_profile_id: actor.actorProfileId, entity_type: "order_task", entity_id: task.id, action: "task.updated", summary: `Reordered order task ${task.title}.`, metadata: { sort_position } });
    return task;
  }
}
