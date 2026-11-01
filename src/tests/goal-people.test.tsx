/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoalListView } from "../components/goals/goal-workspace";
import { goalInputSchema, goalSchema } from "../domain/goals/schema";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../app/actions/goals", () => ({ listGoalsAction: vi.fn(), saveGoalAction: vi.fn(), completeGoalMilestoneAction: vi.fn() }));
const id = "a0000000-0000-4000-8000-000000000001";
const goal = goalSchema.parse({ id, title: "Team goal", description: "", owner_profile_id: id, owner_name: "Test person", owner_avatar_url: "/person.png", due_date: null, visibility: "shared", updated_at: "2026-11-01", created_at: "2026-11-01", photo_path: null, photo_mime: null, photo_size: null, photo_checksum: null, milestone_count: 0, completed_count: 0, milestones: [] });
afterEach(cleanup);
describe("Goal sharing and people", () => {
  it("shows the existing responsible-person photo and falls back on an unavailable image", () => {
    const { container } = render(<GoalListView initial={{ items: [goal], next_before: null }} role="staff" actorId={id} members={[]} />);
    const img = container.querySelector('img[src="/person.png"]');
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(container.querySelector('img[src="/person.png"]')).toBeNull();
    expect(container.querySelector('[data-testid="avatar-fallback"]')).not.toBeNull();
    expect(screen.getByText("Test person")).toBeTruthy();
  });
  it("keeps the list free of redundant visibility tabs and TEAM heading", () => {
    render(<GoalListView initial={{ items: [], next_before: null }} role="owner" actorId={id} members={[]} />);
    expect(screen.getByRole("heading", { name: "Goals" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Goal visibility" })).toBeNull();
    expect(screen.queryByText("TEAM", { exact: true })).toBeNull();
    expect(screen.getByRole("heading", { name: "No goals yet" })).toBeTruthy();
  });
  it("rejects obsolete leadership-only writes before calling the database", () => {
    const input = { title: "Goal", description: "", owner_profile_id: id, due_date: null, milestones: [], request_id: id };
    expect(goalInputSchema.safeParse({ ...input, visibility: "shared" }).success).toBe(true);
    expect(goalInputSchema.safeParse({ ...input, visibility: "leadership" }).success).toBe(false);
  });
});
