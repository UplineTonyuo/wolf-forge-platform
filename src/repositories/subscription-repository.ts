import type {
  CancelSubscriptionInput,
  CreateSubscriptionInput,
  PauseSubscriptionInput,
  SubscriptionDetail,
  SubscriptionDueWork,
  SubscriptionSummary,
  UpdateSubscriptionTermsInput,
} from "../domain/subscriptions/schema";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type {
  InvoiceRow,
  SubscriptionPlanVersionRow,
  SubscriptionRow,
} from "../lib/supabase/database-rows";
import { unwrapOne } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

export class SubscriptionRepository {
  constructor(private readonly client: UserMutationClient) {}

  async workEnabled(): Promise<boolean> {
    const result = await this.client.rpc("app_subscriptions_work_enabled");
    if (result.error) throw mapDatabaseError(result.error, "Subscriptions");
    return result.data === true;
  }

  async list(): Promise<SubscriptionSummary[]> {
    const result = await this.client.rpc("app_list_subscription_summaries");
    if (result.error) throw mapDatabaseError(result.error, "Subscriptions");
    return (result.data ?? []) as SubscriptionSummary[];
  }

  async getById(id: string): Promise<SubscriptionDetail> {
    const result = await this.client.rpc("app_get_subscription_detail", {
      p_subscription_id: id,
    });
    if (result.error) throw mapDatabaseError(result.error, "Subscription");
    if (result.data == null) throw mapDatabaseError({ code: "PGRST116" }, "Subscription");
    return result.data as SubscriptionDetail;
  }

  async listDueWork(limit = 100): Promise<SubscriptionDueWork[]> {
    const result = await this.client.rpc("app_list_due_subscription_work", { p_limit: limit });
    if (result.error) throw mapDatabaseError(result.error, "Subscription work");
    return (result.data ?? []) as SubscriptionDueWork[];
  }

  async create(input: CreateSubscriptionInput): Promise<SubscriptionRow> {
    const { request_id: requestId, ...payload } = input;
    return unwrapOne(
      await this.client.rpc("app_create_subscription", {
        p_request_id: requestId,
        p_payload: payload,
      }),
      "Subscription",
    ) as SubscriptionRow;
  }

  async updateTerms(id: string, input: UpdateSubscriptionTermsInput): Promise<SubscriptionPlanVersionRow> {
    const { request_id: requestId, ...payload } = input;
    return unwrapOne(
      await this.client.rpc("app_update_subscription_terms", {
        p_request_id: requestId,
        p_subscription_id: id,
        p_payload: payload,
      }),
      "Subscription terms",
    ) as SubscriptionPlanVersionRow;
  }

  async generateCycleInvoice(cycleId: string, requestId: string): Promise<InvoiceRow> {
    return unwrapOne(
      await this.client.rpc("app_generate_subscription_cycle_invoice", {
        p_request_id: requestId,
        p_cycle_id: cycleId,
      }),
      "Subscription cycle invoice",
    ) as InvoiceRow;
  }

  async reconcile(id: string): Promise<SubscriptionRow> {
    return unwrapOne(
      await this.client.rpc("app_reconcile_subscription_state", { p_subscription_id: id }),
      "Subscription",
    ) as SubscriptionRow;
  }

  async pause(id: string, input: PauseSubscriptionInput): Promise<SubscriptionRow> {
    return unwrapOne(
      await this.client.rpc("app_pause_subscription", {
        p_subscription_id: id,
        p_resumes_at: input.resumes_at ?? undefined,
      }),
      "Subscription",
    ) as SubscriptionRow;
  }

  async resume(id: string): Promise<SubscriptionRow> {
    return unwrapOne(
      await this.client.rpc("app_resume_subscription", { p_subscription_id: id }),
      "Subscription",
    ) as SubscriptionRow;
  }

  async scheduleCancellation(id: string, input: CancelSubscriptionInput): Promise<SubscriptionRow> {
    return unwrapOne(
      await this.client.rpc("app_schedule_subscription_cancellation", {
        p_subscription_id: id,
        p_reason: input.reason ?? undefined,
      }),
      "Subscription",
    ) as SubscriptionRow;
  }

  async removeCancellation(id: string): Promise<SubscriptionRow> {
    return unwrapOne(
      await this.client.rpc("app_remove_subscription_cancellation", { p_subscription_id: id }),
      "Subscription",
    ) as SubscriptionRow;
  }

  async cancel(id: string, input: CancelSubscriptionInput): Promise<SubscriptionRow> {
    return unwrapOne(
      await this.client.rpc("app_cancel_subscription", {
        p_subscription_id: id,
        p_reason: input.reason ?? undefined,
      }),
      "Subscription",
    ) as SubscriptionRow;
  }
}
