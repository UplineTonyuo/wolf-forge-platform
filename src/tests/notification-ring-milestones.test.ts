import { describe, expect, it } from "vitest";
import { bellRingMilestones, shouldRingForUnread } from "../domain/notifications/ring";

/**
 * The bell rings at one, three, five and nine unread — and stays still for
 * everything else. These cases are the specification, written out one
 * transition at a time so a future change to the rule has to argue with them.
 */
describe("notification bell ring milestones", () => {
  it("carries exactly the four milestones", () => {
    expect(bellRingMilestones).toEqual([1, 3, 5, 9]);
  });

  it("rings on the way up at 1, 3, 5 and 9", () => {
    expect(shouldRingForUnread(0, 1)).toBe(true);
    expect(shouldRingForUnread(2, 3)).toBe(true);
    expect(shouldRingForUnread(4, 5)).toBe(true);
    expect(shouldRingForUnread(8, 9)).toBe(true);
  });

  it("stays silent between the milestones", () => {
    expect(shouldRingForUnread(1, 2)).toBe(false);
    expect(shouldRingForUnread(3, 4)).toBe(false);
    expect(shouldRingForUnread(5, 6)).toBe(false);
    expect(shouldRingForUnread(6, 7)).toBe(false);
    expect(shouldRingForUnread(7, 8)).toBe(false);
  });

  it("adds no further milestones above nine", () => {
    for (let next = 10; next <= 20; next += 1) {
      expect(shouldRingForUnread(next - 1, next)).toBe(false);
    }
    expect(shouldRingForUnread(9, 15)).toBe(false);
  });

  it("never rings when the count falls, so marking read is quiet", () => {
    expect(shouldRingForUnread(5, 3)).toBe(false);
    expect(shouldRingForUnread(2, 1)).toBe(false);
    expect(shouldRingForUnread(9, 5)).toBe(false);
    expect(shouldRingForUnread(1, 0)).toBe(false);
  });

  it("never rings when nothing changed, so a re-render or poll cannot retrigger it", () => {
    for (const count of [0, 1, 3, 5, 9, 12]) {
      expect(shouldRingForUnread(count, count)).toBe(false);
    }
  });

  it("rings once when several arrive at once and land on a milestone", () => {
    expect(shouldRingForUnread(0, 3)).toBe(true);
    expect(shouldRingForUnread(0, 5)).toBe(true);
    // A jump that lands between milestones stays silent, by design.
    expect(shouldRingForUnread(0, 4)).toBe(false);
  });
});
