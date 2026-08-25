import type { IntegrationConnectionRow } from "../domain/integrations/schema";
import { unwrapMany } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

export interface IntegrationConnectionReader {
  listConnections(): Promise<IntegrationConnectionRow[]>;
}

export class IntegrationRepository implements IntegrationConnectionReader {
  constructor(private readonly client: UserMutationClient) {}

  async listConnections(): Promise<IntegrationConnectionRow[]> {
    return unwrapMany(
      await this.client.rpc("app_list_integration_connections"),
    ) as IntegrationConnectionRow[];
  }
}
