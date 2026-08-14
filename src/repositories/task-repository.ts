import { randomUUID } from "node:crypto";
import type { CreateTaskInput, UpdateTaskInput } from "../domain/tasks/schema";
import type { OrderTaskRow } from "../lib/supabase/database-rows";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

export class TaskRepository {
  constructor(private readonly client: UserMutationClient) {}

  async create(input: CreateTaskInput): Promise<OrderTaskRow> {
    return unwrapOne(await this.client.rpc("app_create_task", {
      p_request_id: input.request_id ?? randomUUID(),
      p_order_id: input.order_id,
      p_title: input.title,
      p_assigned_to_profile_id: input.assigned_to_profile_id ?? undefined,
      p_description: input.description ?? undefined,
      p_due_at: input.due_at ?? undefined,
      p_sort_position: input.sort_position,
    }), "Project task") as OrderTaskRow;
  }

  async getById(id: string): Promise<OrderTaskRow> {
    return unwrapOne(await this.client.from("order_tasks").select().eq("id", id).single(), "Order task") as OrderTaskRow;
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
    ) as OrderTaskRow[];
  }

  async update(id: string, input: UpdateTaskInput): Promise<OrderTaskRow> {
    return unwrapOne(await this.client.rpc("app_update_task", {
      p_task_id: id,
      p_patch: input,
    }), "Project task") as OrderTaskRow;
  }

  async assign(id: string, profileId: string | null): Promise<OrderTaskRow> {
    return unwrapOne(await this.client.rpc("app_assign_task", {
      p_task_id: id,
      p_assigned_to_profile_id: profileId ?? undefined,
    }), "Order task") as OrderTaskRow;
  }

  async changeStatus(id: string, status: OrderTaskRow["status"]): Promise<OrderTaskRow> {
    return unwrapOne(await this.client.rpc("app_change_task_status", {
      p_task_id: id,
      p_status: status,
    }), "Project task") as OrderTaskRow;
  }

  async reorder(id: string, sortPosition: number): Promise<OrderTaskRow> {
    return unwrapOne(
      await this.client.rpc("app_reorder_task", { p_task_id: id, p_sort_position: sortPosition }),
      "Project task",
    ) as OrderTaskRow;
  }
}
