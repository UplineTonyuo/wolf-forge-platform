import type { CreateServiceInput, UpdateServiceInput } from "../domain/services/schema.js";
import type { ServiceRow } from "../lib/supabase/database.types.js";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers.js";
import type { DatabaseClient } from "./types.js";

export class ServiceRepository {
  constructor(private readonly client: DatabaseClient) {}

  async create(input: CreateServiceInput): Promise<ServiceRow> {
    return unwrapOne(await this.client.from("services").insert(input).select().single(), "Service");
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
    return unwrapOne(await this.client.from("services").update(input).eq("id", id).select().single(), "Service");
  }

  async archive(id: string, archivedAt: string): Promise<ServiceRow> {
    return unwrapOne(
      await this.client.from("services").update({ archived_at: archivedAt, is_active: false }).eq("id", id).select().single(),
      "Service",
    );
  }
}
