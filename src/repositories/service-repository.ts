import { randomUUID } from "node:crypto";
import type { CreateServiceInput, UpdateServiceInput } from "../domain/services/schema.js";
import type { ServiceRow } from "../lib/supabase/database-rows.js";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers.js";
import type { UserMutationClient } from "./types.js";

export class ServiceRepository {
  constructor(private readonly client: UserMutationClient) {}

  async create(input: CreateServiceInput): Promise<ServiceRow> {
    return unwrapOne(await this.client.rpc("app_create_service", {
      p_request_id: input.request_id ?? randomUUID(),
      p_name: input.name,
      p_description: input.description ?? undefined,
      p_is_active: input.is_active,
    }), "Service");
  }

  async getById(id: string): Promise<ServiceRow> {
    return unwrapOne(await this.client.from("services").select().eq("id", id).single(), "Service");
  }

  async listActive(): Promise<ServiceRow[]> {
    return unwrapMany(
      await this.client
        .from("services")
        .select()
        .eq("is_active", true)
        .is("archived_at", null)
        .order("name"),
    );
  }

  async update(id: string, input: UpdateServiceInput): Promise<ServiceRow> {
    return unwrapOne(await this.client.rpc("app_update_service", { p_service_id: id, p_patch: input }), "Service");
  }

  async archive(id: string): Promise<ServiceRow> {
    return unwrapOne(
      await this.client.rpc("app_archive_service", { p_service_id: id }),
      "Service",
    );
  }
}
