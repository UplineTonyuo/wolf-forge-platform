import { describe, expect, it, vi } from "vitest";
import { composeProjectRows, countUnansweredOrders, emptyProjectFilterCriteria, filterProjectRows, type ProjectRelationRow } from "../domain/orders/projections";
import { OrderRepository } from "../repositories/order-repository";
import { OrderService } from "../services/order-service";

const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const source = (orderId = id) => ({ id: orderId, status: "waiting_reply", created_at: "2026-01-01", companies: null, services: null, profiles: null }) as ProjectRelationRow;

describe("Orders response-state projection", () => {
  it("keeps unavailable response metadata unknown, separate from task attention", () => {
    const rows = composeProjectRows([source()], []);
    expect(rows[0]?.needsAttention).toBe(true);
    expect(rows[0]?.unanswered).toBeNull();
    expect(filterProjectRows(rows, { ...emptyProjectFilterCriteria, unansweredOnly: true })).toEqual([]);
  });
  it("filters and counts only authoritative unanswered orders", () => {
    const rows = composeProjectRows([source(), source(other)], [], new Date(), [{ order_id: id, unanswered: true }, { order_id: other, unanswered: false }]);
    expect(countUnansweredOrders(rows)).toBe(1);
    expect(filterProjectRows(rows, { ...emptyProjectFilterCriteria, unansweredOnly: true }).map((row) => row.id)).toEqual([id]);
  });
});

describe("Orders response-state batch", () => {
  it("uses the authenticated batch RPC once and skips empty lists", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ order_id: id, unanswered: true }], error: null });
    const repository = new OrderRepository({ rpc } as never);
    expect(await repository.listResponseStates([])).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
    expect(await repository.listResponseStates([id, id])).toEqual([{ order_id: id, unanswered: true }]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("app_list_order_response_states", { p_order_ids: [id] });
  });
  it("rejects a failed or malformed response instead of inventing answered state", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    const repository = new OrderRepository({ rpc } as never);
    await expect(repository.listResponseStates([id])).rejects.toThrow();
    rpc.mockResolvedValue({ data: [{ order_id: id, unanswered: "false" }], error: null } as never);
    await expect(repository.listResponseStates([id])).rejects.toThrow();
  });
  it("loads metadata in one batch and preserves inaccessible or absent results as unknown", async () => {
    const repository = {
      hydrateMissingAssignees: async (rows: ProjectRelationRow[]) => rows,
      listRelationRows: vi.fn().mockResolvedValue({ rows: [source(), source(other)], totalCount: 2 }),
      listTaskFacts: vi.fn().mockResolvedValue([]),
      listResponseStates: vi.fn().mockResolvedValue([{ order_id: id, unanswered: true }]),
    };
    const result = await new OrderService({ repository } as never).listProjects();
    expect(repository.listResponseStates).toHaveBeenCalledExactlyOnceWith([id, other]);
    expect(result.rows.map((row) => row.unanswered)).toEqual([true, null]);
  });
  it("keeps authorized order rows visible if metadata is denied or the migration is absent", async () => {
    const repository = {
      hydrateMissingAssignees: async (rows: ProjectRelationRow[]) => rows,
      listRelationRows: vi.fn().mockResolvedValue({ rows: [source()], totalCount: 1 }),
      listTaskFacts: vi.fn().mockResolvedValue([]),
      listResponseStates: vi.fn().mockRejectedValue(new Error("unavailable")),
    };
    const result = await new OrderService({ repository } as never).listProjects();
    expect(result.rows[0]?.unanswered).toBeNull();
    expect(result.complete).toBe(true);
  });
});
