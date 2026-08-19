import type {
  InvestmentIntentRow,
  RecordStoreInterestInput,
  SetInvestmentIntentStatusInput,
} from "../domain/store-interest/schema";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type { ServiceInterestRow } from "../lib/supabase/database-rows";
import { unwrapOne } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

/**
 * Investment intent access.
 *
 * Three RPCs, no table access. The write RPC takes service ids only -- the
 * company is derived from the session inside the database -- and the two
 * internal calls re-authorize through the investment_intent module before they
 * return or change anything.
 */
export class StoreInterestRepository {
  constructor(private readonly client: UserMutationClient) {}

  /** Returns how many interest rows the call actually wrote. */
  async record(input: RecordStoreInterestInput): Promise<number> {
    const result = await this.client.rpc("app_record_store_interest", {
      p_service_ids: input.serviceIds,
      p_in_cart: input.inCart,
    });

    if (result.error) throw mapDatabaseError(result.error, "Investment interest");
    return result.data ?? 0;
  }

  async list(limit?: number): Promise<InvestmentIntentRow[]> {
    const result = await this.client.rpc(
      "app_list_investment_intents",
      limit === undefined ? {} : { p_limit: limit },
    );

    if (result.error) throw mapDatabaseError(result.error, "Investment Intent");
    return (result.data ?? []) as unknown as InvestmentIntentRow[];
  }

  async setStatus(input: SetInvestmentIntentStatusInput): Promise<ServiceInterestRow> {
    return unwrapOne(
      await this.client.rpc("app_set_investment_intent_status", {
        p_intent_id: input.intentId,
        p_status: input.status,
      }),
      "Investment Intent",
    ) as ServiceInterestRow;
  }
}
