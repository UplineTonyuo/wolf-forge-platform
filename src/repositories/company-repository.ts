import type { CreateCompanyInput, UpdateCompanyInput } from "../domain/companies/schema.js";
import type { CompanyRow } from "../lib/supabase/database.types.js";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers.js";
import type { DatabaseClient } from "./types.js";

export class CompanyRepository {
  constructor(private readonly client: DatabaseClient) {}

  async create(input: CreateCompanyInput): Promise<CompanyRow> {
    return unwrapOne(
      await this.client.from("companies").insert(input).select().single(),
      "Company",
    );
  }

  async getById(id: string): Promise<CompanyRow> {
    return unwrapOne(
      await this.client.from("companies").select().eq("id", id).single(),
      "Company",
    );
  }

  async listActive(): Promise<CompanyRow[]> {
    return unwrapMany(
      await this.client.from("companies").select().is("archived_at", null).order("name"),
    );
  }

  async update(id: string, input: UpdateCompanyInput): Promise<CompanyRow> {
    return unwrapOne(
      await this.client.from("companies").update(input).eq("id", id).select().single(),
      "Company",
    );
  }

  async archive(id: string, archivedAt: string): Promise<CompanyRow> {
    return unwrapOne(
      await this.client.from("companies").update({ archived_at: archivedAt }).eq("id", id).select().single(),
      "Company",
    );
  }
}
