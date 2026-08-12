import { describe, expect, it, vi } from "vitest";
import type { OrderRow, OrderTaskRow } from "../lib/supabase/database.types.js";
import { OrderService } from "../services/order-service.js";
import { TaskService } from "../services/task-service.js";

const actorId = "20000000-0000-4000-8000-000000000001";
const entityId = "50000000-0000-4000-8000-000000000001";
const completedAt = "2026-08-12T10:00:00.000Z";

function order(status: OrderRow["status"], completion: string | null): OrderRow {
  return { id: entityId, order_number: 42, company_id: actorId, service_id: actorId, assigned_to_profile_id: null, title: "Test", status, priority: "normal", due_at: null, started_at: null, completed_at: completion, notes: null, created_at: completedAt, updated_at: completedAt, archived_at: null };
}

function task(status: OrderTaskRow["status"], completion: string | null): OrderTaskRow {
  return { id: entityId, order_id: actorId, assigned_to_profile_id: null, title: "Task", description: null, status, due_at: null, sort_position: 0, completed_at: completion, created_at: completedAt, updated_at: completedAt, archived_at: null };
}

describe("service orchestration", () => {
  it("sends a single completion patch and writes activity", async () => {
    const repository = { getById: vi.fn().mockResolvedValue(order("working", null)), update: vi.fn().mockResolvedValue(order("complete", completedAt)) };
    const activity = { recordUserAction: vi.fn(), recordSystemAction: vi.fn() };
    const service = new OrderService({ repository: repository as never, activity, now: () => new Date(completedAt) });

    await service.changeStatus(entityId, { status: "complete" }, { actorProfileId: actorId });

    expect(repository.update).toHaveBeenCalledWith(entityId, { status: "complete", completed_at: completedAt });
    expect(activity.recordUserAction).toHaveBeenCalledWith(expect.objectContaining({ actor_profile_id: actorId, action: "order.status_changed", metadata: { from: "working", to: "complete" } }));
  });

  it("clears task completion and writes activity when reopening", async () => {
    const repository = { getById: vi.fn().mockResolvedValue(task("complete", completedAt)), update: vi.fn().mockResolvedValue(task("in_progress", null)) };
    const activity = { recordUserAction: vi.fn(), recordSystemAction: vi.fn() };
    const service = new TaskService({ repository: repository as never, activity });

    await service.changeStatus(entityId, { status: "in_progress" }, { actorProfileId: actorId });

    expect(repository.update).toHaveBeenCalledWith(entityId, { status: "in_progress", completed_at: null });
    expect(activity.recordUserAction).toHaveBeenCalledWith(expect.objectContaining({ action: "task.status_changed", metadata: { from: "complete", to: "in_progress" } }));
  });

  it("records assignments as meaningful activity", async () => {
    const repository = { assign: vi.fn().mockResolvedValue(order("pending", null)) };
    const activity = { recordUserAction: vi.fn(), recordSystemAction: vi.fn() };
    const service = new OrderService({ repository: repository as never, activity });

    await service.assign(entityId, actorId, { actorProfileId: actorId });
    expect(activity.recordUserAction).toHaveBeenCalledWith(expect.objectContaining({ action: "order.assigned", metadata: { assigned_to_profile_id: actorId } }));
  });

  it("records task reordering as an update activity", async () => {
    const repository = { reorder: vi.fn().mockResolvedValue({ ...task("todo", null), sort_position: 3 }) };
    const activity = { recordUserAction: vi.fn(), recordSystemAction: vi.fn() };
    const service = new TaskService({ repository: repository as never, activity });

    await service.reorder(entityId, { sort_position: 3 }, { actorProfileId: actorId });
    expect(repository.reorder).toHaveBeenCalledWith(entityId, 3);
    expect(activity.recordUserAction).toHaveBeenCalledWith(expect.objectContaining({ action: "task.updated", metadata: { sort_position: 3 } }));
  });
});
