import { randomUUID } from "node:crypto";
import type { ClientContactRow, OrganizationRow } from "../lib/supabase/database-rows";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

export type OrganizationMember = { organizationId: string; contact: ClientContactRow };

/** Company / Team entities. Separate from `companies`, which holds Client records. */
export class OrganizationRepository {
  constructor(private readonly client: UserMutationClient) {}

  async create(input: { request_id?: string; name: string }): Promise<OrganizationRow> {
    return unwrapOne(
      await this.client.rpc("app_create_organization", {
        p_request_id: input.request_id ?? randomUUID(),
        p_name: input.name,
      }),
      "Company",
    );
  }

  async getById(id: string): Promise<OrganizationRow> {
    return unwrapOne(
      await this.client.from("organizations").select().eq("id", id).is("archived_at", null).single(),
      "Company",
    );
  }

  async listActive(): Promise<OrganizationRow[]> {
    return unwrapMany(
      await this.client.from("organizations").select().is("archived_at", null).order("name").order("id"),
    );
  }

  async update(id: string, name: string): Promise<OrganizationRow> {
    return unwrapOne(
      await this.client.rpc("app_update_organization", { p_organization_id: id, p_name: name }),
      "Company",
    );
  }

  /** Explicit membership rows only; archived contacts are hidden by contact RLS and dropped. */
  async listMembers(organizationIds: string[]): Promise<OrganizationMember[]> {
    if (organizationIds.length === 0) return [];
    const rows = unwrapMany(
      await this.client
        .from("organization_members")
        .select("organization_id, contact:client_contacts(*)")
        .in("organization_id", organizationIds)
        .order("created_at"),
    );
    return rows.flatMap((row) => (row.contact ? [{ organizationId: row.organization_id, contact: row.contact }] : []));
  }

  async addMember(organizationId: string, contactId: string): Promise<void> {
    unwrapOne(
      await this.client.rpc("app_add_organization_member", {
        p_organization_id: organizationId,
        p_contact_id: contactId,
      }),
      "Company person",
    );
  }
}
