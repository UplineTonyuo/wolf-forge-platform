import { randomUUID } from "node:crypto";
import type { CreateContactInput, UpdateContactInput } from "../domain/contacts/schema";
import type { ClientContactRow } from "../lib/supabase/database-rows";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

export class ContactRepository {
  constructor(private readonly client: UserMutationClient) {}

  async create(input: CreateContactInput): Promise<ClientContactRow> {
    return unwrapOne(
      await this.client.rpc("app_create_contact", {
        p_request_id: input.request_id ?? randomUUID(),
        p_company_id: input.company_id,
        p_name: input.name,
        p_profile_id: input.profile_id ?? undefined,
        p_email: input.email ?? undefined,
        p_phone: input.phone ?? undefined,
        p_job_title: input.job_title ?? undefined,
        p_is_primary: input.is_primary,
      }),
      "Client contact",
    );
  }

  async getById(id: string): Promise<ClientContactRow> {
    return unwrapOne(
      await this.client.from("client_contacts").select().eq("id", id).single(),
      "Client contact",
    );
  }

  async listForCompany(companyId: string): Promise<ClientContactRow[]> {
    return unwrapMany(
      await this.client
        .from("client_contacts")
        .select()
        .eq("company_id", companyId)
        .is("archived_at", null)
        .order("is_primary", { ascending: false })
        .order("name"),
    );
  }

  async listForCompanies(companyIds: string[]): Promise<ClientContactRow[]> {
    if (companyIds.length === 0) return [];

    return unwrapMany(
      await this.client
        .from("client_contacts")
        .select()
        .in("company_id", companyIds)
        .is("archived_at", null)
        .order("is_primary", { ascending: false })
        .order("name"),
    );
  }

  async update(id: string, input: UpdateContactInput): Promise<ClientContactRow> {
    return unwrapOne(
      await this.client.rpc("app_update_contact", { p_contact_id: id, p_patch: input }),
      "Client contact",
    );
  }

  async archive(id: string): Promise<ClientContactRow> {
    return unwrapOne(
      await this.client.rpc("app_archive_contact", { p_contact_id: id }),
      "Client contact",
    );
  }
}
