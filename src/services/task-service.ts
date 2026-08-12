import { changeTaskStatusSchema, createTaskSchema, reorderTaskSchema, updateTaskSchema } from "../domain/tasks/schema.js";
import { parseInput, uuidSchema } from "../domain/shared.js";
import { TaskRepository } from "../repositories/task-repository.js";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context.js";

export class TaskService {
  constructor(private readonly dependencies: ServiceDependencies<TaskRepository>) {}
  get(id: unknown) { return this.dependencies.repository.getById(parseInput(uuidSchema, id)); }
  listForOrder(orderId: unknown) { return this.dependencies.repository.listForOrder(parseInput(uuidSchema, orderId)); }

  async create(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.create(parseInput(createTaskSchema, input));
  }

  async update(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.update(
      parseInput(uuidSchema, id),
      parseInput(updateTaskSchema, input),
    );
  }

  async changeStatus(id: unknown, input: unknown, actor: UserMutationActor) {
    const taskId = parseInput(uuidSchema, id);
    const requested = parseInput(changeTaskStatusSchema, input);
    requireVerifiedActor(actor);
    return this.dependencies.repository.changeStatus(taskId, requested.status);
  }

  async assign(id: unknown, profileId: unknown, actor: UserMutationActor) {
    const assignee = parseInput(uuidSchema.nullable(), profileId);
    requireVerifiedActor(actor);
    return this.dependencies.repository.assign(parseInput(uuidSchema, id), assignee);
  }

  async reorder(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    const { sort_position } = parseInput(reorderTaskSchema, input);
    return this.dependencies.repository.reorder(parseInput(uuidSchema, id), sort_position);
  }
}
