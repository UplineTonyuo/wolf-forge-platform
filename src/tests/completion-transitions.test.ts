import { describe, expect, it } from "vitest";
import { orderCompletionPatch } from "../domain/orders/schema.js";
import { taskCompletionPatch } from "../domain/tasks/schema.js";

const fixedNow = () => new Date("2026-08-12T10:00:00.000Z");

describe("completion transitions", () => {
  it("generates order completion time when entering complete", () => {
    expect(orderCompletionPatch("complete", undefined, fixedNow)).toEqual({ status: "complete", completed_at: "2026-08-12T10:00:00.000Z" });
  });

  it("preserves an explicit historical order completion time", () => {
    expect(orderCompletionPatch("complete", "2026-08-01T00:00:00.000Z", fixedNow).completed_at).toBe("2026-08-01T00:00:00.000Z");
  });

  it("clears order completion time when leaving complete", () => {
    expect(orderCompletionPatch("working", "2026-08-01T00:00:00.000Z", fixedNow)).toEqual({ status: "working", completed_at: null });
  });

  it("generates task completion time when entering complete", () => {
    expect(taskCompletionPatch("complete", undefined, fixedNow)).toEqual({ status: "complete", completed_at: "2026-08-12T10:00:00.000Z" });
  });

  it("clears task completion time when leaving complete", () => {
    expect(taskCompletionPatch("in_progress", "2026-08-01T00:00:00.000Z", fixedNow)).toEqual({ status: "in_progress", completed_at: null });
  });
});
