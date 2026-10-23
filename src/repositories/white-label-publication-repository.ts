import {
  decodePublicationPreflight, decodePublicationReconciliation, decodePublishWhiteLabelResult, decodeRuntimeWhiteLabelConfiguration,
  type PublicationPreflight, type PublicationReceipt, type PublicationReconciliation, type PublishWhiteLabelInput,
  type PublishWhiteLabelResult, type RuntimeWhiteLabelConfiguration,
} from "../domain/white-label/publication";
import { ConflictError, DatabaseError } from "../lib/errors/application-error";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type { UserMutationClient } from "./types";

export class WhiteLabelPublicationRepository {
  constructor(private readonly client: UserMutationClient) {}

  async getRuntimeConfiguration(): Promise<RuntimeWhiteLabelConfiguration> {
    const { data, error } = await this.client.rpc("app_get_runtime_white_label_configuration");
    if (error) throw mapDatabaseError(error, "Tenant configuration");
    return decodeRuntimeWhiteLabelConfiguration(data);
  }

  async preflight(input: Pick<PublishWhiteLabelInput, "tenantId" | "sourceDraftRevision" | "expectedPublicationRevision">): Promise<PublicationPreflight> {
    const { data, error } = await this.client.rpc("app_preflight_white_label_publication", {
      p_tenant_id: input.tenantId, p_source_draft_revision: input.sourceDraftRevision, p_expected_publication_revision: input.expectedPublicationRevision,
    });
    if (error) throw mapDatabaseError(error, "Tenant configuration");
    const result = decodePublicationPreflight(data);
    if (result.tenantId !== input.tenantId || result.sourceDraftRevision !== input.sourceDraftRevision ||
        result.expectedPublicationRevision !== input.expectedPublicationRevision) throw new DatabaseError();
    return result;
  }

  async publish(input: PublishWhiteLabelInput): Promise<PublishWhiteLabelResult> {
    const { data, error } = await this.client.rpc("app_publish_white_label_draft", this.arguments(input));
    this.checkError(error);
    const result = decodePublishWhiteLabelResult(data);
    this.checkReceipt(result.receipt, input);
    return result;
  }

  async reconcile(input: PublishWhiteLabelInput): Promise<PublicationReconciliation> {
    const { data, error } = await this.client.rpc("app_reconcile_white_label_publication", this.arguments(input));
    this.checkError(error);
    const result = decodePublicationReconciliation(data);
    if (result.outcome === "applied") this.checkReceipt(result.receipt, input);
    return result;
  }

  private arguments(input: PublishWhiteLabelInput) {
    return { p_tenant_id: input.tenantId, p_source_draft_revision: input.sourceDraftRevision,
      p_expected_publication_revision: input.expectedPublicationRevision, p_request_id: input.requestId, p_reason: input.reason };
  }

  private checkError(error: unknown) {
    if (!error) return;
    if ((error as { code?: string }).code === "WF409") throw new ConflictError("The saved draft, publication or request binding changed.", error);
    throw mapDatabaseError(error, "Tenant configuration");
  }

  private checkReceipt(receipt: PublicationReceipt, input: PublishWhiteLabelInput) {
    if (receipt.configuration.tenantId !== input.tenantId || receipt.configuration.sourceDraftRevision !== input.sourceDraftRevision ||
        receipt.requestId !== input.requestId || receipt.expectedPublicationRevision !== input.expectedPublicationRevision ||
        receipt.reason !== input.reason) throw new DatabaseError();
  }
}
