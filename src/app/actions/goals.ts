"use server";
import { revalidatePath } from "next/cache";
import { getInternalContext } from "../../lib/supabase/next-server";
import { toClientSafeError } from "../../lib/errors/application-error";
import { GoalRepository } from "../../repositories/goal-repository";
import { GoalService } from "../../services/goal-service";
import type { GoalVisibility } from "../../domain/goals/schema";

export async function listGoalsAction(before: string | null = null, visibility: GoalVisibility | null = null) {
  const context = await getInternalContext();
  try {
    return { ok: true as const, data: await new GoalService(new GoalRepository(context.client)).list(before, visibility) };
  } catch (error) { return { ok: false as const, error: toClientSafeError(error).message }; }
}

export async function saveGoalAction(id: string | null, input: unknown, revision: string | null) {
  const context = await getInternalContext();
  try {
    const goal = await new GoalService(new GoalRepository(context.client)).save(id, input, revision, context.actor);
    revalidatePath("/team/goals"); revalidatePath("/team/goals/" + goal.id);
    return { ok: true as const, goal };
  } catch (error) { return { ok: false as const, error: toClientSafeError(error).message }; }
}
export async function completeGoalMilestoneAction(id: string, milestoneId: string, completed: boolean) {
  const context = await getInternalContext();
  try {
    const goal = await new GoalService(new GoalRepository(context.client)).complete(id, milestoneId, completed, context.actor);
    revalidatePath("/team/goals"); revalidatePath("/team/goals/" + goal.id);
    return { ok: true as const, goal };
  } catch (error) { return { ok: false as const, error: toClientSafeError(error).message }; }
}
