import type {
  SaveWhiteLabelDraftInput,
  SavedWhiteLabelDraft,
  WhiteLabelDraft,
  WhiteLabelTenant,
  WhiteLabelTenantStatus,
} from "../domain/white-label/draft";
import { modulesFromKeys } from "../domain/white-label/draft";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors/application-error";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import { unwrapMany } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

/**
 * White Label drafts (WL-2.33). Every call is a SECURITY DEFINER RPC that
 * re-checks the Platform Admin entitlement from auth.uid(); the draft tables
 * are revoked from every API role.
 */
export class WhiteLabelRepository {
  constructor(private readonly client: UserMutationClient) {}

  async listTenants(): Promise<WhiteLabelTenant[]> {
    const rows = unwrapMany(await this.client.rpc("app_list_white_label_tenants"));
    return rows.map((row) => ({
      id: row.tenant_id,
      slug: row.slug,
      displayName: row.display_name,
      status: row.status as WhiteLabelTenantStatus,
      draftRevision: row.draft_revision,
    }));
  }

  async getDraft(tenantId: string): Promise<WhiteLabelDraft> {
    const [row] = unwrapMany(await this.client.rpc("app_get_white_label_draft", { p_tenant_id: tenantId }));
    if (!row) throw new NotFoundError("Tenant");
    return {
      tenantId: row.tenant_id,
      tenantStatus: row.tenant_status as WhiteLabelTenantStatus,
      state: {
        displayName: row.display_name,
        primaryColor: row.primary_color,
        accentColor: row.accent_color,
        modules: modulesFromKeys(row.module_keys),
      },
      revision: row.revision,
      updatedAt: row.updated_at,
    };
  }

  async saveDraft(input: SaveWhiteLabelDraftInput): Promise<SavedWhiteLabelDraft> {
    const { data, error } = await this.client.rpc("app_save_white_label_draft", {
      p_tenant_id: input.tenantId,
      p_expected_revision: input.expectedRevision,
      p_display_name: input.displayName,
      p_primary_color: input.primaryColor,
      p_accent_color: input.accentColor,
      p_module_keys: input.moduleKeys,
    });
    if (error?.code === "WF409") {
      throw new ConflictError("Someone else saved this draft after you opened it.", error);
    }
    if (error?.code === "55000") {
      throw new ValidationError("This Tenant is not active, so its draft is read-only.", error);
    }
    if (error) throw mapDatabaseError(error, "Tenant");
    const [row] = data ?? [];
    // No row means the write cannot be confirmed: never report it as saved.
    if (!row) throw mapDatabaseError(null);
    return { revision: row.revision, updatedAt: row.updated_at };
  }
}
