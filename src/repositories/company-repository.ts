import { randomUUID } from "node:crypto";
import type { CreateCompanyInput, UpdateCompanyInput } from "../domain/companies/schema.js";
import type { CompanyRow } from "../lib/supabase/database-rows.js";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers.js";
import type { UserMutationClient } from "./types.js";

export class CompanyRepository {
  constructor(private readonly client: UserMutationClient) {}

  async create(input: CreateCompanyInput): Promise<CompanyRow> {
    return unwrapOne(
      await this.client.rpc("app_create_company", {
        // The HTTP/UI layer can retain request_id across retries. Direct callers
        // get a fresh key for a one-shot request when they omit it.
        p_request_id: input.request_id ?? randomUUID(),
        p_name: input.name,
      }),
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
      await this.client.rpc("app_update_company", { p_company_id: id, p_patch: input }),
      "Client",
    );
  }

  async archive(id: string): Promise<CompanyRow> {
    return unwrapOne(
      await this.client.rpc("app_archive_company", { p_company_id: id }),
      "Company",
    );
  }
}
