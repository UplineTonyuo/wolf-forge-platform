import type { CreateTaskInput, UpdateTaskInput } from "../domain/tasks/schema.js";
import type { OrderTaskRow } from "../lib/supabase/database.types.js";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers.js";
import type { DatabaseClient } from "./types.js";

export class TaskRepository {
  constructor(private readonly client: DatabaseClient) {}

  async create(input: CreateTaskInput): Promise<OrderTaskRow> {
    return unwrapOne(await this.client.from("order_tasks").insert(input).select().single(), "Order task");
  }

  async getById(id: string): Promise<OrderTaskRow> {
    return unwrapOne(await this.client.from("order_tasks").select().eq("id", id).single(), "Order task");
  }

  async listForOrder(orderId: string): Promise<OrderTaskRow[]> {
    return unwrapMany(
      await this.client
        .from("order_tasks")
        .select()
        .eq("order_id", orderId)
        .is("archived_at", null)
        .order("sort_position")
        .order("created_at"),
    );
  }

  async update(id: string, input: UpdateTaskInput | Partial<OrderTaskRow>): Promise<OrderTaskRow> {
    return unwrapOne(await this.client.from("order_tasks").update(input).eq("id", id).select().single(), "Order task");
  }

  async assign(id: string, profileId: string | null): Promise<OrderTaskRow> {
    return this.update(id, { assigned_to_profile_id: profileId });
  }

  async reorder(id: string, sortPosition: number): Promise<OrderTaskRow> {
    return this.update(id, { sort_position: sortPosition });
  }
}
