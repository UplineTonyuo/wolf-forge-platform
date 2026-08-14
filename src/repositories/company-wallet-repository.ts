import { randomUUID } from "node:crypto";
import type {
  AdjustCompanyBalanceInput,
} from "../domain/wallets/schema";
import type {
  CompanyWalletRow,
  CompanyWalletTransactionRow,
} from "../lib/supabase/database-rows";
import {
  unwrapMany,
  unwrapOne,
} from "../lib/supabase/repository-helpers";
import type {
  UserMutationClient,
} from "./types";

export type CompanyWalletNotificationRow = {
  transaction_id: string;
  company_id: string;
  company_name: string;
  client_name: string;
  actor_profile_id: string;
  actor_display_name: string | null;
  amount_cents: number;
  balance_after_cents: number;
  currency: string;
  source: string;
  reason: string | null;
  created_at: string;
  is_current_actor: boolean;
};

export class CompanyWalletRepository {
  constructor(
    private readonly client:
      UserMutationClient,
  ) {}

  async getForCompany(
    companyId: string,
  ): Promise<CompanyWalletRow> {
    return unwrapOne(
      await this.client.rpc(
        "app_get_company_wallet",
        {
          p_company_id: companyId,
        },
      ),
      "Client wallet",
    );
  }

  async listRecent(
    limit = 10,
  ): Promise<
    CompanyWalletNotificationRow[]
  > {
    return unwrapMany(
      await this.client.rpc(
        "app_list_recent_company_wallet_transactions",
        {
          p_limit: limit,
        },
      ),
    ) as CompanyWalletNotificationRow[];
  }

  async adjust(
    input: AdjustCompanyBalanceInput,
  ): Promise<CompanyWalletTransactionRow> {
    return unwrapOne(
      await this.client.rpc(
        "app_adjust_company_balance",
        {
          p_request_id:
            input.request_id ??
            randomUUID(),

          p_company_id:
            input.company_id,

          p_amount_cents:
            input.amount_cents,

          p_reason:
            input.reason ?? undefined,
        },
      ),
      "Client wallet transaction",
    );
  }
}
