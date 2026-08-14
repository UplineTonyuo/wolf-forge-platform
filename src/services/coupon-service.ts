import { createCouponSchema, couponPayloadSchema } from "../domain/coupons/schema";
import { parseInput, uuidSchema } from "../domain/shared";
import { CouponRepository } from "../repositories/coupon-repository";
import { requireVerifiedActor, type ServiceDependencies, type UserMutationActor } from "./mutation-context";

export class CouponService {
  constructor(private readonly dependencies: ServiceDependencies<CouponRepository>) {}

  list(archived = false) {
    return this.dependencies.repository.list(archived);
  }

  get(id: unknown) {
    return this.dependencies.repository.getById(parseInput(uuidSchema, id));
  }

  create(input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.create(parseInput(createCouponSchema, input));
  }

  update(id: unknown, input: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.update(
      parseInput(uuidSchema, id),
      parseInput(couponPayloadSchema, input),
    );
  }

  archive(id: unknown, actor: UserMutationActor) {
    requireVerifiedActor(actor);
    return this.dependencies.repository.archive(parseInput(uuidSchema, id));
  }
}
