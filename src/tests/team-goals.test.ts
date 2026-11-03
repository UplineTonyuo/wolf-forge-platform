import { describe, expect, it } from "vitest";
import { goalInputSchema, goalProgress, canManageGoals, canCompleteGoal } from "../domain/goals/schema";

const owner = "a0000000-0000-4000-8000-000000000001";
const valid = { title: "Office", description: "", owner_profile_id: owner, due_date: "2026-11-30", visibility: "shared", milestones: [{ title: "Choose location" }], request_id: "a0000000-0000-4000-8000-000000000002" };
describe("Team Goals", () => {
  it("derives progress from milestones without dividing by zero", () => {
    expect(goalProgress([])).toEqual({ completed: 0, total: 0, percent: 0 });
    expect(goalProgress([{ completed_at: "now" }, { completed_at: null }])).toEqual({ completed: 1, total: 2, percent: 50 });
  });
  it("bounds goal input and validates real dates", () => {
    expect(goalInputSchema.parse(valid).title).toBe("Office");
    for (const input of [{ ...valid, title: " " }, { ...valid, due_date: "2026-02-30" }, { ...valid, milestones: Array.from({ length: 51 }, () => ({ title: "item" })) }, { ...valid, role: "owner" }]) {
      expect(goalInputSchema.safeParse(input).success).toBe(false);
    }
  });
  it("reserves management for Owner/Admin and progress for assigned shared goals", () => {
    expect(["owner", "admin"].every(canManageGoals)).toBe(true);
    expect(["manager", "staff", "client"].some(canManageGoals)).toBe(false);
    expect(canCompleteGoal("staff", owner, { owner_profile_id: owner, visibility: "shared" })).toBe(true);
    expect(canCompleteGoal("staff", owner, { owner_profile_id: owner, visibility: "leadership" })).toBe(false);
    expect(canCompleteGoal("client", owner, { owner_profile_id: owner, visibility: "shared" })).toBe(false);
    expect(canCompleteGoal("manager", "other", { owner_profile_id: owner, visibility: "shared" })).toBe(false);
  });
});
