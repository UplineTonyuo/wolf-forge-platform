import { z } from "zod";
import { uuidSchema } from "../shared";

/**
 * Investment intent: the durable record that a client showed interest in an
 * investment.
 *
 * The client portal cart stays exactly what it was -- browser state, a request
 * cart, no checkout. This is the sales signal underneath it, and the vocabulary
 * follows the existing split: the code says service, the internal product says
 * Investment Intent.
 */

/**
 * The internal sales workflow.
 *
 * Deliberately six values and no seventh for "renewed". Renewed interest is an
 * activity signal -- a client re-adding something -- not a state William moved
 * it into, and folding the two together would let a client silently undo a
 * decision by clicking a button in the Store.
 */
export const investmentIntentStatuses = [
  "new",
  "reviewing",
  "contacted",
  "qualified",
  "closed",
  "not_interested",
] as const;

export const investmentIntentStatusSchema = z.enum(investmentIntentStatuses);
export type InvestmentIntentStatus = z.infer<typeof investmentIntentStatusSchema>;

export const investmentIntentStatusLabels: Record<InvestmentIntentStatus, string> = {
  new: "New",
  reviewing: "Reviewing",
  contacted: "Contacted",
  qualified: "Qualified",
  closed: "Closed",
  not_interested: "Not interested",
};

export function isInvestmentIntentStatus(value: unknown): value is InvestmentIntentStatus {
  return investmentIntentStatusSchema.safeParse(value).success;
}

/**
 * What the browser is allowed to say about a cart change.
 *
 * Service ids and a direction, and nothing else. There is deliberately no
 * company field: the database derives the company from the authenticated
 * session, so there is nothing here for a caller to get wrong or to forge.
 *
 * The 12 cap matches `cartLimit`, so clearing a full cart is one call.
 */
export const recordStoreInterestSchema = z.object({
  serviceIds: z.array(uuidSchema).min(1).max(12),
  inCart: z.boolean(),
});

export type RecordStoreInterestInput = z.infer<typeof recordStoreInterestSchema>;

export const setInvestmentIntentStatusSchema = z.object({
  intentId: uuidSchema,
  status: investmentIntentStatusSchema,
});

export type SetInvestmentIntentStatusInput = z.infer<typeof setInvestmentIntentStatusSchema>;

/**
 * One row of the internal read model, as `app_list_investment_intents` returns
 * it. Nullable columns are typed nullable here even though the generated RPC
 * types report them as non-null: PostgreSQL cannot express per-column
 * nullability for a `returns table`, and the projection has to survive a null
 * category or an intent nobody has contacted yet.
 */
export type InvestmentIntentRow = {
  intent_id: string;
  company_id: string;
  company_name: string;
  service_id: string;
  service_name: string;
  folder_name: string | null;
  price: number;
  currency: string;
  recurring: boolean;
  recurring_price: number | null;
  recurring_interval_length: number | null;
  recurring_interval_unit: string | null;
  status: string;
  in_cart: boolean;
  add_count: number;
  first_added_at: string;
  last_added_at: string;
  removed_at: string | null;
  last_activity_at: string;
  contacted_at: string | null;
  contacted_by_profile_id: string | null;
  contacted_by_name: string | null;
  updated_at: string;
  /**
   * The live investment conversation for this client and investment, if one
   * exists. Advisory only -- `tickets_active_investment_conversation_unique`
   * is what actually prevents a second active conversation, so a null here is
   * a hint that creating one is allowed, never a guarantee that it will win.
   */
  active_ticket_id: string | null;
  active_ticket_status: string | null;
};
