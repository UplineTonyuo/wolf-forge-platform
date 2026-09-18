import type { ProjectConversation } from "../domain/orders/project-conversation-schema";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type { UserMutationClient } from "./types";

export class ProjectConversationRepository {
  constructor(private readonly client: UserMutationClient) {}

  async get(orderId: string): Promise<ProjectConversation | null> {
    // Cast inline at the call site — app_get_project_conversation is not yet
    // in the generated database types (mirrors the same workaround already
    // used in ticket-repository.ts for other not-yet-regenerated RPCs).
    // Extracting `this.client.rpc` into a variable first detaches it from
    // `this.client`, and supabase-js's rpc() needs that binding internally.
    const result = await (this.client.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>)("app_get_project_conversation", {
      p_order_id: orderId,
    });
    if (result.error) throw mapDatabaseError(result.error, "Project conversation");
    return result.data as ProjectConversation | null;
  }
}
