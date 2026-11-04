import { randomUUID } from "node:crypto";
import type { CreateCompanyInput, UpdateCompanyInput } from "../domain/companies/schema";
import type { CompanyRow } from "../lib/supabase/database-rows";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

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
    const rows = unwrapMany(
      await this.client.rpc("app_list_client_company_directory"),
    );

    // The operational directory intentionally excludes processor identity.
    // Preserve the existing CompanyRow-facing component contract without
    // inventing or exposing a Stripe value.
    return rows.map((row) => ({
      ...row,
      stripe_customer_id: null,
    }));
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

  async managerOptions() {
    return unwrapMany(await this.client.rpc("app_list_client_manager_options"));
  }
  async managerAssignments() {
    return unwrapMany(await this.client.rpc("app_list_client_manager_assignments"));
  }
  async assignManager(id: string, managerId: string) {
    const result = await this.client.rpc("app_assign_client_manager", { p_company_id: id, p_manager_profile_id: managerId });
    const persisted = unwrapOne(result, "Client manager");
    if (persisted !== managerId) throw new Error("Manager assignment could not be confirmed.");
  }
}
