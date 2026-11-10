import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ClientProjectSourceRow } from "../domain/orders/client-projections";
import { clientOrderStartSchema } from "../domain/orders/client-start";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type { OrderResponseState, ProjectRelationRow, ProjectTaskFact } from "../domain/orders/projections";
import type { CreateOrderInput, UpdateOrderInput } from "../domain/orders/schema";
import type { ReportCompletionScope, ReportExceptionInput } from "../domain/reporting/order-completion";
import type { OrderRow } from "../lib/supabase/database-rows";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers";
import type { ListOrdersFilter, UserMutationClient } from "./types";

/**
 * Client and Service use their real foreign keys. Assignees now belong through
 * Tenant memberships; the authorized operational projection resolves them.
 */
const projectRelationSelect = "*, companies(id, name), services(id, name)";

export type ProjectLabelRow = Pick<OrderRow, "id" | "order_number" | "title">;

export type ProjectRelationPage = {
  rows: ProjectRelationRow[];
  /** Total rows matching the filter, independent of the applied row limit. */
  totalCount: number | null;
};

/** Guard against an unbounded scan; the caller reports truncation honestly. */
export const projectListRowLimit = 2000;

const orderResponseStatesSchema = z.array(z.object({
  order_id: z.uuid(),
  unanswered: z.boolean().nullable(),
}));

export class OrderRepository {
  constructor(private readonly client: UserMutationClient) {}

  async listClientResponseStates(orderIds: string[]): Promise<OrderResponseState[]> {
    if (orderIds.length === 0) return [];
    const ids = [...new Set(z.array(z.uuid()).max(projectListRowLimit).parse(orderIds))];
    const result = await this.client.rpc("app_list_my_order_response_states", { p_order_ids: ids });
    if (result.error) throw mapDatabaseError(result.error, "Order reply status");
    return orderResponseStatesSchema.parse(result.data);
  }

  async listResponseStates(orderIds: string[]): Promise<OrderResponseState[]> {
    if (orderIds.length === 0) return [];
    const ids = z.array(z.uuid()).max(projectListRowLimit).parse([...new Set(orderIds)]);
    const result = await this.client.rpc("app_list_order_response_states", { p_order_ids: ids });
    if (result.error) throw mapDatabaseError(result.error, "Order response status");
    return orderResponseStatesSchema.parse(result.data);
  }

  async getClientStartState(id: string) {
    const result = await this.client.rpc("app_get_my_order_start", { p_order_id: id });
    if (result.error) throw mapDatabaseError(result.error, "Order start");
    return clientOrderStartSchema.nullable().parse(result.data);
  }

  async requestClientStart(id: string) {
    const result = await this.client.rpc("app_request_my_order_start", { p_order_id: id });
    if (result.error) throw mapDatabaseError(result.error, "Order start");
    return clientOrderStartSchema.parse(result.data);
  }

  /**
   * Resolve assignee labels through the Tenant membership projection without
   * exposing the rest of a teammate's profile. One request covers every row.
   */
  private async hydrateMissingAssignees(sourceRows: ProjectRelationRow[]): Promise<ProjectRelationRow[]> {
    const rows = sourceRows.map((row) => ({ ...row, profiles: row.profiles ?? null }));
    const missingIds = new Set(
      rows
        .filter((row) => row.assigned_to_profile_id && !row.profiles)
        .map((row) => row.assigned_to_profile_id as string),
    );
    if (missingIds.size === 0) return rows;

    const assignees = unwrapMany(await this.client.rpc("app_list_operational_assignees"));
    const namesById = new Map(
      assignees
        .filter((assignee) => missingIds.has(assignee.profile_id))
        .map((assignee) => [assignee.profile_id, assignee] as const),
    );

    return rows.map((row) => {
      if (row.profiles || !row.assigned_to_profile_id) return row;
      if (!namesById.has(row.assigned_to_profile_id)) return row;
      return {
        ...row,
        profiles: {
          id: row.assigned_to_profile_id,
          display_name: namesById.get(row.assigned_to_profile_id)?.display_name ?? null,
          avatar_url: namesById.get(row.assigned_to_profile_id)?.avatar_url ?? null,
        },
      };
    });
  }

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
    const row = unwrapOne(
      await this.client.from("orders").select(projectRelationSelect).eq("id", id).single(),
      "Project",
    ) as unknown as ProjectRelationRow;
    const [hydrated] = await this.hydrateMissingAssignees([row]);
    return hydrated ?? row;
  }

  async listWithRelations(filter: ListOrdersFilter = {}): Promise<ProjectRelationPage> {
    let query = this.client.from("orders").select(projectRelationSelect, { count: "exact" });
    if (filter.companyId) query = query.eq("company_id", filter.companyId);
    if (filter.serviceId) query = query.eq("service_id", filter.serviceId);
    if (filter.assignedToProfileId) query = query.eq("assigned_to_profile_id", filter.assignedToProfileId);
    if (filter.status) query = query.eq("status", filter.status);
    if (!filter.includeArchived) query = query.is("archived_at", null);

    const result = await query.order("created_at", { ascending: false }).limit(projectListRowLimit);
    const rows = unwrapMany(result) as unknown as ProjectRelationRow[];
    return {
      rows: await this.hydrateMissingAssignees(rows),
      totalCount: result.count,
    };
  }

  /**
   * Client portal reads use SECURITY DEFINER DTO RPCs. The database derives the
   * caller company, requires portal_projects, and never exposes orders or task
   * rows through PostgREST.
   */
  async listForClientPortal(): Promise<ClientProjectSourceRow[]> {
    return unwrapMany(
      await this.client.rpc("app_list_my_client_projects", {
        p_limit: projectListRowLimit,
      }),
    ) as unknown as ClientProjectSourceRow[];
  }

  async getForClientPortal(id: string): Promise<ClientProjectSourceRow> {
    const rows = unwrapMany(
      await this.client.rpc("app_get_my_client_project", {
        p_project_id: id,
      }),
    ) as unknown as ClientProjectSourceRow[];

    return unwrapOne(
      { data: rows[0] ?? null, error: null },
      "Project",
    );
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

  async setReportingMonth(id: string, input: ReportCompletionScope): Promise<OrderRow> {
    return unwrapOne(await this.client.rpc("app_set_order_reporting_month", {
      p_order_id: id, p_service_id: input.serviceId, p_reporting_period_month: input.reportingPeriodMonth,
    }), "Order") as OrderRow;
  }

  async completeForReportingMonth(id: string, input: ReportCompletionScope): Promise<OrderRow> {
    return unwrapOne(await this.client.rpc("app_complete_order_for_reporting_month", {
      p_order_id: id, p_service_id: input.serviceId, p_reporting_period_month: input.reportingPeriodMonth,
    }), "Order") as OrderRow;
  }

  async completeWithoutReport(id: string, input: ReportExceptionInput): Promise<OrderRow> {
    return unwrapOne(await this.client.rpc("app_complete_order_without_report", {
      p_order_id: id, p_service_id: input.serviceId,
      p_reporting_period_month: input.reportingPeriodMonth, p_reason: input.reason,
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
