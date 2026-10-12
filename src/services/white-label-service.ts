import { parseInput, uuidSchema } from "../domain/shared";
import {
  saveWhiteLabelDraftSchema,
  type SavedWhiteLabelDraft,
  type WhiteLabelDraft,
  type WhiteLabelDraftSummary,
  type WhiteLabelTenant,
} from "../domain/white-label/draft";
import { ValidationError } from "../lib/errors/application-error";
import type { WhiteLabelRepository } from "../repositories/white-label-repository";
import type { ServiceDependencies } from "./mutation-context";

/**
 * Validates shapes and draft rules; the database decides authority (Platform
 * Admin, from auth.uid()) and re-validates every value. A Tenant id only names
 * the target.
 */
export class WhiteLabelService {
  constructor(private readonly dependencies: ServiceDependencies<WhiteLabelRepository>) {}

  listTenants(): Promise<WhiteLabelTenant[]> {
    return this.dependencies.repository.listTenants();
  }

  async listDrafts(): Promise<WhiteLabelDraftSummary[]> {
    const tenants = await this.listTenants();
    const summaries: WhiteLabelDraftSummary[] = [];
    // Bound concurrent RPC reads; each draft still passes the database's entitlement check.
    for (let index = 0; index < tenants.length; index += 6) {
      summaries.push(...await Promise.all(tenants.slice(index, index + 6).map(async (tenant) => ({
        tenant,
        draft: await this.getDraft(tenant.id),
      }))));
    }
    return summaries;
  }

  getDraft(tenantId: unknown): Promise<WhiteLabelDraft> {
    return this.dependencies.repository.getDraft(parseInput(uuidSchema, tenantId));
  }

  saveDraft(input: unknown): Promise<SavedWhiteLabelDraft> {
    const result = saveWhiteLabelDraftSchema.safeParse(input);
    if (!result.success) {
      const custom = result.error.issues.find((issue) => issue.code === "custom");
      throw new ValidationError(custom?.message ?? "The supplied data is invalid.", result.error);
    }
    return this.dependencies.repository.saveDraft(result.data);
  }
}
