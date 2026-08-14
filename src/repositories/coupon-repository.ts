import { randomUUID } from "node:crypto";
import type { CouponPayload, CreateCouponInput } from "../domain/coupons/schema";
import { mapDatabaseError } from "../lib/errors/map-database-error";
import type { CouponDiscountRuleRow, CouponRow } from "../lib/supabase/database-rows";
import { unwrapOne } from "../lib/supabase/repository-helpers";
import type { UserMutationClient } from "./types";

export type CouponListItem = CouponRow & { usageCount: number };
export type CouponRuleDetail = CouponDiscountRuleRow & { serviceIds: string[] };
export type CouponDetail = { coupon: CouponRow; rules: CouponRuleDetail[] };

export class CouponRepository {
  constructor(private readonly client: UserMutationClient) {}

  async list(archived = false): Promise<CouponListItem[]> {
    let query = this.client
      .from("coupons")
      .select("*, coupon_redemptions(count)")
      .order(archived ? "archived_at" : "updated_at", { ascending: false });

    query = archived
      ? query.not("archived_at", "is", null)
      : query.is("archived_at", null);

    const result = await query;
    if (result.error) throw mapDatabaseError(result.error, "Coupon");

    return (result.data ?? []).map(({ coupon_redemptions: redemptions, ...coupon }) => ({
      ...(coupon as CouponRow),
      usageCount: redemptions?.[0]?.count ?? 0,
    }));
  }

  async getById(id: string): Promise<CouponDetail> {
    const [couponResult, rulesResult] = await Promise.all([
      this.client.from("coupons").select().eq("id", id).is("archived_at", null).single(),
      this.client
        .from("coupon_discount_rules")
        .select("*, coupon_discount_services(service_id)")
        .eq("coupon_id", id)
        .order("sort_order"),
    ]);

    const coupon = unwrapOne(couponResult, "Coupon") as CouponRow;
    if (rulesResult.error) throw mapDatabaseError(rulesResult.error, "Coupon discount rule");

    return {
      coupon,
      rules: (rulesResult.data ?? []).map(({ coupon_discount_services: memberships, ...rule }) => ({
        ...rule,
        serviceIds: memberships.map((membership) => membership.service_id),
      })),
    };
  }

  async create(input: CreateCouponInput): Promise<CouponRow> {
    const { request_id: requestId, ...payload } = input;
    return unwrapOne(
      await this.client.rpc("app_create_coupon", {
        p_request_id: requestId || randomUUID(),
        p_payload: payload,
      }),
      "Coupon",
    ) as CouponRow;
  }

  async update(id: string, payload: CouponPayload): Promise<CouponRow> {
    return unwrapOne(
      await this.client.rpc("app_update_coupon", { p_coupon_id: id, p_payload: payload }),
      "Coupon",
    ) as CouponRow;
  }

  async archive(id: string): Promise<CouponRow> {
    return unwrapOne(
      await this.client.rpc("app_archive_coupon", { p_coupon_id: id }),
      "Coupon",
    ) as CouponRow;
  }
}
