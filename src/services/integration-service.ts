import {
  toIntegrationConnectionViews,
  type IntegrationConnectionView,
} from "../domain/integrations/schema";
import type { IntegrationConnectionReader } from "../repositories/integration-repository";

export class IntegrationService {
  constructor(private readonly dependencies: { repository: IntegrationConnectionReader }) {}

  async listConnections(): Promise<IntegrationConnectionView[]> {
    return toIntegrationConnectionViews(await this.dependencies.repository.listConnections());
  }
}
