import { z } from "zod";

export const GOAL_PHOTO_BUCKET = "team-goal-photos";
export const GOAL_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const goalVisibilitySchema = z.enum(["shared", "leadership"]);
export type GoalVisibility = z.infer<typeof goalVisibilitySchema>;
export const goalInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000),
  owner_profile_id: z.uuid(),
  due_date: z.iso.date().nullable(),
  visibility: goalVisibilitySchema,
  milestones: z.array(z.object({ id: z.uuid().optional(), title: z.string().trim().min(1).max(200) }).strict()).max(50),
  request_id: z.uuid(),
}).strict();
export type GoalInput = z.infer<typeof goalInputSchema>;
export const goalMemberSchema = z.object({
  id: z.uuid(), display_name: z.string(), role: z.enum(["owner", "admin", "manager", "staff"]),
});
export type GoalMember = z.infer<typeof goalMemberSchema>;
export const goalSchema = z.object({
  id: z.uuid(), title: z.string(), description: z.string(),
  owner_profile_id: z.uuid(), owner_name: z.string(), due_date: z.iso.date().nullable(),
  visibility: goalVisibilitySchema, updated_at: z.string(), created_at: z.string(),
  photo_path: z.string().nullable(), photo_mime: z.string().nullable(),
  photo_size: z.number().nullable(), photo_checksum: z.string().nullable(),
  completed_count: z.number().int().nonnegative(), milestone_count: z.number().int().nonnegative(),
  milestones: z.array(z.object({ id: z.uuid(), title: z.string(), completed_at: z.string().nullable() })),
});
export type Goal = z.infer<typeof goalSchema>;
export const goalListSchema = z.object({ items: z.array(goalSchema), next_before: z.uuid().nullable() });
export type GoalList = z.infer<typeof goalListSchema>;
export function goalProgress(milestones: { completed_at: string | null }[]) {
  const total = milestones.length;
  const completed = milestones.filter((item) => item.completed_at !== null).length;
  return { completed, total, percent: total ? Math.round(completed / total * 100) : 0 };
}
export function canManageGoals(role: string): boolean { return role === "owner" || role === "admin"; }
export function canCompleteGoal(role: string, actorId: string, goal: Pick<Goal, "owner_profile_id" | "visibility">): boolean {
  return canManageGoals(role) || (["manager", "staff"].includes(role) && goal.visibility === "shared" && goal.owner_profile_id === actorId);
}
