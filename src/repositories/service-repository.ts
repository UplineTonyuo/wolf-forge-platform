import { randomUUID } from "node:crypto";
import type {
  CreateServiceFolderInput,
  CreateServiceInput,
  UpdateServiceFolderInput,
  UpdateServiceInput,
} from "../domain/services/schema";
import type { ServiceFolderRow, ServiceRow } from "../lib/supabase/database-rows";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

export type ServiceAssigneeOption = {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
};

export class ServiceRepository {
  constructor(private readonly client: UserMutationClient) {}

  async create(input: CreateServiceInput): Promise<ServiceRow> {
    const { request_id: requestId, ...payload } = input;
    return unwrapOne(
      await this.client.rpc("app_create_service", {
        p_request_id: requestId ?? randomUUID(),
        p_payload: payload,
      }),
      "Service",
    );
  }

  async duplicate(id: string, requestId: string = randomUUID()): Promise<ServiceRow> {
    return unwrapOne(
      await this.client.rpc("app_duplicate_service", {
        p_request_id: requestId,
        p_service_id: id,
      }),
      "Service",
    );
  }

  async getById(id: string): Promise<ServiceRow> {
    return unwrapOne(
      await this.client.from("services").select().eq("id", id).is("archived_at", null).single(),
      "Service",
    );
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

  async listCatalog(): Promise<ServiceRow[]> {
    return unwrapMany(
      await this.client
        .from("services")
        .select()
        .is("archived_at", null)
        .order("sort_order")
        .order("name"),
    );
  }

  /**
   * The client Store slice of the catalog. RLS already narrows a client session
   * to public, active, non-archived services; the predicates are restated here
   * so the query means the same thing whoever runs it.
   */
  async listStoreServices(): Promise<ServiceRow[]> {
    return unwrapMany(
      await this.client
        .from("services")
        .select()
        .eq("is_public", true)
        .eq("is_active", true)
        .is("archived_at", null)
        .order("sort_order")
        .order("name"),
    );
  }

  async getStoreService(id: string): Promise<ServiceRow> {
    return unwrapOne(
      await this.client
        .from("services")
        .select()
        .eq("id", id)
        .eq("is_public", true)
        .eq("is_active", true)
        .is("archived_at", null)
        .single(),
      "Service",
    );
  }

  async update(id: string, input: UpdateServiceInput): Promise<ServiceRow> {
    return unwrapOne(
      await this.client.rpc("app_update_service", { p_service_id: id, p_patch: input }),
      "Service",
    );
  }

  async archive(id: string): Promise<ServiceRow> {
    return unwrapOne(
      await this.client.rpc("app_archive_service", { p_service_id: id }),
      "Service",
    );
  }

  async createFolder(input: CreateServiceFolderInput): Promise<ServiceFolderRow> {
    return unwrapOne(
      await this.client.rpc("app_create_service_folder", {
        p_request_id: input.request_id ?? randomUUID(),
        p_name: input.name,
        p_description: input.description ?? undefined,
        p_parent_id: input.parent_id ?? undefined,
        p_sort_order: input.sort_order,
      }),
      "Service folder",
    );
  }

  async getFolderById(id: string): Promise<ServiceFolderRow> {
    return unwrapOne(
      await this.client
        .from("service_folders")
        .select()
        .eq("id", id)
        .is("archived_at", null)
        .single(),
      "Service folder",
    );
  }

  async listFolders(): Promise<ServiceFolderRow[]> {
    return unwrapMany(
      await this.client
        .from("service_folders")
        .select()
        .is("archived_at", null)
        .order("sort_order")
        .order("name"),
    );
  }

  async updateFolder(id: string, input: UpdateServiceFolderInput): Promise<ServiceFolderRow> {
    return unwrapOne(
      await this.client.rpc("app_update_service_folder", {
        p_folder_id: id,
        p_patch: input,
      }),
      "Service folder",
    );
  }

  async setFolderSubscriptionEligibility(id: string, eligible: boolean): Promise<number> {
    const { data, error } = await this.client.rpc("app_set_service_folder_subscription_eligibility", {
      p_folder_id: id,
      p_eligible: eligible,
    });
    if (error) throw mapDatabaseError(error, "Service folder");
    return data;
  }

  async archiveFolder(id: string): Promise<ServiceFolderRow> {
    return unwrapOne(
      await this.client.rpc("app_archive_service_folder", { p_folder_id: id }),
      "Service folder",
    );
  }

  async listAssignees(): Promise<ServiceAssigneeOption[]> {
    return unwrapMany(await this.client.rpc("app_list_operational_assignees"))
      .map((profile) => ({
        id: profile.profile_id,
        displayName: profile.display_name ?? "Unnamed teammate",
        avatarUrl: profile.avatar_url,
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }
}
