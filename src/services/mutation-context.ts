import { assertVerifiedActor, type VerifiedActor } from "../lib/supabase/user-client";

export type UserMutationActor = VerifiedActor;

export function requireVerifiedActor(actor: UserMutationActor): void {
  assertVerifiedActor(actor);
}

export type ServiceDependencies<Repository> = {
  repository: Repository;
};
