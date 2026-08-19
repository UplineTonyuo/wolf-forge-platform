import type {
  AssignTicketInput,
  CreateTicketInput,
  TicketDetail,
  TicketMessageInput,
  TicketSummary,
  UpdateTicketPriorityInput,
  UpdateTicketStatusInput,
} from "../domain/tickets/schema";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type { Json } from "../lib/supabase/database.types";
import type { TicketMessageRow, TicketRow } from "../lib/supabase/database-rows";
import { unwrapOne } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

export class TicketRepository {
  constructor(private readonly client: UserMutationClient) {}

  async list(includeArchived = false): Promise<TicketSummary[]> {
    const result = await this.client.rpc("app_list_ticket_summaries", {
      p_include_archived: includeArchived,
    });
    if (result.error) throw mapDatabaseError(result.error, "Tickets");
    return (result.data ?? []) as TicketSummary[];
  }

  async getById(id: string): Promise<TicketDetail> {
    const result = await this.client.rpc("app_get_ticket_detail_with_avatars", { p_ticket_id: id });
    if (result.error) throw mapDatabaseError(result.error, "Ticket");
    if (result.data == null) throw mapDatabaseError({ code: "PGRST116" }, "Ticket");
    return result.data as TicketDetail;
  }

  async create(input: CreateTicketInput): Promise<TicketRow> {
    const { request_id: requestId, ...payload } = input;
    return unwrapOne(
      await this.client.rpc("app_create_ticket", {
        p_request_id: requestId,
        p_payload: payload as Json,
      }),
      "Ticket",
    ) as TicketRow;
  }

  async reply(id: string, input: TicketMessageInput): Promise<TicketMessageRow> {
    return unwrapOne(
      await this.client.rpc("app_reply_to_ticket", {
        p_request_id: input.request_id,
        p_ticket_id: id,
        p_body: input.body,
      }),
      "Ticket reply",
    ) as TicketMessageRow;
  }

  async addInternalNote(id: string, input: TicketMessageInput): Promise<TicketMessageRow> {
    return unwrapOne(
      await this.client.rpc("app_add_ticket_internal_note", {
        p_request_id: input.request_id,
        p_ticket_id: id,
        p_body: input.body,
      }),
      "Ticket note",
    ) as TicketMessageRow;
  }

  async updateStatus(id: string, input: UpdateTicketStatusInput): Promise<TicketRow> {
    return unwrapOne(
      await this.client.rpc("app_update_ticket_status", {
        p_ticket_id: id,
        p_status: input.status,
      }),
      "Ticket",
    ) as TicketRow;
  }

  async updatePriority(id: string, input: UpdateTicketPriorityInput): Promise<TicketRow> {
    return unwrapOne(
      await this.client.rpc("app_update_ticket_priority", {
        p_ticket_id: id,
        p_priority: input.priority,
      }),
      "Ticket",
    ) as TicketRow;
  }

  async assign(id: string, input: AssignTicketInput): Promise<TicketRow> {
    return unwrapOne(
      await this.client.rpc("app_assign_ticket", {
        p_ticket_id: id,
        p_assigned_to_profile_id: input.assigned_to_profile_id ?? undefined,
      }),
      "Ticket",
    ) as TicketRow;
  }

  async archive(id: string): Promise<TicketRow> {
    return unwrapOne(
      await this.client.rpc("app_archive_ticket", { p_ticket_id: id }),
      "Ticket",
    ) as TicketRow;
  }
}
