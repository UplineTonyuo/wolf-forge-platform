import type { CreateOrderInput, UpdateOrderInput } from "../domain/orders/schema.js";
import type { OrderRow } from "../lib/supabase/database.types.js";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers.js";
import type { DatabaseClient, ListOrdersFilter } from "./types.js";

export class OrderRepository {
  constructor(private readonly client: DatabaseClient) {}

  async create(input: CreateOrderInput): Promise<OrderRow> {
    return unwrapOne(await this.client.from("orders").insert(input).select().single(), "Order");
  }

  async getById(id: string): Promise<OrderRow> {
    return unwrapOne(await this.client.from("orders").select().eq("id", id).single(), "Order");
  }

  async list(filter: ListOrdersFilter = {}): Promise<OrderRow[]> {
    let query = this.client.from("orders").select();
    if (filter.companyId) query = query.eq("company_id", filter.companyId);
    if (filter.status) query = query.eq("status", filter.status);
    if (!filter.includeArchived) query = query.is("archived_at", null);
    return unwrapMany(await query.order("created_at", { ascending: false }));
  }

  async listForCompany(companyId: string): Promise<OrderRow[]> {
    return this.list({ companyId });
  }

  async update(id: string, input: UpdateOrderInput | Partial<OrderRow>): Promise<OrderRow> {
    return unwrapOne(await this.client.from("orders").update(input).eq("id", id).select().single(), "Order");
  }

  async assign(id: string, profileId: string | null): Promise<OrderRow> {
    return this.update(id, { assigned_to_profile_id: profileId });
  }

  async archive(id: string, archivedAt: string): Promise<OrderRow> {
    return this.update(id, { archived_at: archivedAt });
  }
}
