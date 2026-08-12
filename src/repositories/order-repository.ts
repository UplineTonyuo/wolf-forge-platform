import { randomUUID } from "node:crypto";
import type { CreateOrderInput, UpdateOrderInput } from "../domain/orders/schema.js";
import type { OrderRow } from "../lib/supabase/database-rows.js";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers.js";
import type { ListOrdersFilter, UserMutationClient } from "./types.js";

export class OrderRepository {
  constructor(private readonly client: UserMutationClient) {}

  async create(input: CreateOrderInput): Promise<OrderRow> {
    return unwrapOne(await this.client.rpc("app_create_order", {
      p_request_id: input.request_id ?? randomUUID(),
      p_company_id: input.company_id,
      p_service_id: input.service_id,
      p_title: input.title,
      p_assigned_to_profile_id: input.assigned_to_profile_id ?? undefined,
      p_priority: input.priority,
      p_due_at: input.due_at ?? undefined,
      p_started_at: input.started_at ?? undefined,
      p_notes: input.notes ?? undefined,
    }), "Project") as OrderRow;
  }

  async getById(id: string): Promise<OrderRow> {
    return unwrapOne(await this.client.from("orders").select().eq("id", id).single(), "Order") as OrderRow;
  }

  async list(filter: ListOrdersFilter = {}): Promise<OrderRow[]> {
    let query = this.client.from("orders").select();
    if (filter.companyId) query = query.eq("company_id", filter.companyId);
    if (filter.status) query = query.eq("status", filter.status);
    if (!filter.includeArchived) query = query.is("archived_at", null);
    return unwrapMany(await query.order("created_at", { ascending: false })) as OrderRow[];
  }

  async listForCompany(companyId: string): Promise<OrderRow[]> {
    return this.list({ companyId });
  }

  async update(id: string, input: UpdateOrderInput): Promise<OrderRow> {
    return unwrapOne(await this.client.rpc("app_update_order", {
      p_order_id: id,
      p_patch: input,
    }), "Project") as OrderRow;
  }

  async assign(id: string, profileId: string | null): Promise<OrderRow> {
    return unwrapOne(await this.client.rpc("app_assign_order", {
      p_order_id: id,
      p_assigned_to_profile_id: profileId ?? undefined,
    }), "Order") as OrderRow;
  }

  async changeStatus(id: string, status: OrderRow["status"]): Promise<OrderRow> {
    return unwrapOne(await this.client.rpc("app_change_order_status", {
      p_order_id: id,
      p_status: status,
    }), "Project") as OrderRow;
  }

  async archive(id: string): Promise<OrderRow> {
    return unwrapOne(await this.client.rpc("app_archive_order", { p_order_id: id }), "Project") as OrderRow;
  }
}
