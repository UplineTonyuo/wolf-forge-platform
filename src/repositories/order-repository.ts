import { randomUUID } from "node:crypto";
import type { ProjectRelationRow, ProjectTaskFact } from "../domain/orders/projections";
import type { CreateOrderInput, UpdateOrderInput } from "../domain/orders/schema";
import type { OrderRow } from "../lib/supabase/database-rows";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers";
import type { ListOrdersFilter, UserMutationClient } from "./types";

/**
 * One round trip resolves the Client, Service and assignee through their real
 * foreign keys. PostgREST applies RLS to every embedded resource, so this never
 * widens visibility, and it avoids a per-row lookup.
 */
const projectRelationSelect = "*, companies(id, name), services(id, name), profiles(id, display_name)";

export type ProjectLabelRow = Pick<OrderRow, "id" | "order_number" | "title">;

export type ProjectRelationPage = {
  rows: ProjectRelationRow[];
  /** Total rows matching the filter, independent of the applied row limit. */
  totalCount: number | null;
};

/** Guard against an unbounded scan; the caller reports truncation honestly. */
export const projectListRowLimit = 2000;

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

  async getWithRelations(id: string): Promise<ProjectRelationRow> {
    return unwrapOne(
      await this.client.from("orders").select(projectRelationSelect).eq("id", id).single(),
      "Project",
    ) as unknown as ProjectRelationRow;
  }

  async listWithRelations(filter: ListOrdersFilter = {}): Promise<ProjectRelationPage> {
    let query = this.client.from("orders").select(projectRelationSelect, { count: "exact" });
    if (filter.companyId) query = query.eq("company_id", filter.companyId);
    if (filter.serviceId) query = query.eq("service_id", filter.serviceId);
    if (filter.assignedToProfileId) query = query.eq("assigned_to_profile_id", filter.assignedToProfileId);
    if (filter.status) query = query.eq("status", filter.status);
    if (!filter.includeArchived) query = query.is("archived_at", null);

    const result = await query.order("created_at", { ascending: false }).limit(projectListRowLimit);
    return {
      rows: unwrapMany(result) as unknown as ProjectRelationRow[],
      totalCount: result.count,
    };
  }

  /** Task facts for the Info column and the shared attention predicate. */
  async listTaskFacts(orderIds: string[]): Promise<ProjectTaskFact[]> {
    if (orderIds.length === 0) return [];
    return unwrapMany(
      await this.client
        .from("order_tasks")
        .select("order_id, status, due_at")
        .in("order_id", orderIds)
        .is("archived_at", null),
    ) as ProjectTaskFact[];
  }

  /** Server-resolved labels so bulk outcomes never echo browser-supplied text. */
  async listLabels(orderIds: string[]): Promise<ProjectLabelRow[]> {
    if (orderIds.length === 0) return [];
    return unwrapMany(
      await this.client.from("orders").select("id, order_number, title").in("id", orderIds),
    ) as ProjectLabelRow[];
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
