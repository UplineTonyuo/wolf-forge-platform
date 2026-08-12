import type { CreateContactInput, UpdateContactInput } from "../domain/contacts/schema.js";
import type { ClientContactRow } from "../lib/supabase/database.types.js";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers.js";
import type { DatabaseClient } from "./types.js";

export class ContactRepository {
  constructor(private readonly client: DatabaseClient) {}

  async create(input: CreateContactInput): Promise<ClientContactRow> {
    return unwrapOne(
      await this.client.from("client_contacts").insert(input).select().single(),
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

  async update(id: string, input: UpdateContactInput): Promise<ClientContactRow> {
    return unwrapOne(
      await this.client.from("client_contacts").update(input).eq("id", id).select().single(),
      "Client contact",
    );
  }

  async archive(id: string, archivedAt: string): Promise<ClientContactRow> {
    return unwrapOne(
      await this.client.from("client_contacts").update({ archived_at: archivedAt, is_primary: false }).eq("id", id).select().single(),
      "Client contact",
    );
  }
}
