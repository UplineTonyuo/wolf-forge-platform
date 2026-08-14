import { randomUUID } from "node:crypto";
import type {
  CreateServiceFolderInput,
  CreateServiceInput,
  UpdateServiceFolderInput,
  UpdateServiceInput,
} from "../domain/services/schema";
import type { ServiceFolderRow, ServiceRow } from "../lib/supabase/database-rows";
import { unwrapMany, unwrapOne } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

export type ServiceAssigneeOption = {
  id: string;
  displayName: string;
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

  async archiveFolder(id: string): Promise<ServiceFolderRow> {
    return unwrapOne(
      await this.client.rpc("app_archive_service_folder", { p_folder_id: id }),
      "Service folder",
    );
  }

  async listAssignees(): Promise<ServiceAssigneeOption[]> {
    const [profiles, roles] = await Promise.all([
      this.client
        .from("profiles")
        .select("id, display_name, role_id")
        .is("archived_at", null),
      this.client.from("roles").select("id, name"),
    ]);
    const internalRoleIds = new Set(
      unwrapMany(roles)
        .filter((role) => ["owner", "admin", "manager", "staff"].includes(role.name))
        .map((role) => role.id),
    );

    return unwrapMany(profiles)
      .filter((profile) => internalRoleIds.has(profile.role_id))
      .map((profile) => ({
        id: profile.id,
        displayName: profile.display_name ?? "Unnamed teammate",
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }
}
