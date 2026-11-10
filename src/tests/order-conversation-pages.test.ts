import { describe, expect, it, vi } from "vitest";
import { TicketRepository } from "../repositories/ticket-repository";
import { TicketService } from "../services/ticket-service";
import type { UserMutationClient } from "../repositories/types";

const orderId = "10000000-0000-4000-8000-000000000001";
const cursor = '{"order":"10000000-0000-4000-8000-000000000001","source":"project","direction":"before","at":"2026-11-10T10:00:00.123456+00:00","id":"10000000-0000-4000-8000-000000000002"}';

describe("bounded Order conversation reads", () => {
  it("uses a separate bounded RPC and preserves the exact database cursor", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { messages: [], page: { hasOlder: false } }, error: null });
    const repository = new TicketRepository({ rpc } as unknown as UserMutationClient);
    await repository.getOrderPage(orderId, { direction: "before", cursor });
    expect(rpc).toHaveBeenCalledWith("app_get_order_conversation_page", {
      p_order_id: orderId, p_direction: "before", p_cursor: cursor,
      p_retained_ids: [], p_fingerprint: null, p_request_ids: [],
    });
  });

  it.each([
    { direction: "before" },
    { direction: "latest", cursor },
    { direction: "unknown" },
    { direction: "refresh", retainedIds: Array.from({ length: 101 }, () => orderId) },
    { direction: "refresh", retainedIds: ["foreign-input"] },
    { direction: "refresh", requestIds: Array.from({ length: 101 }, () => orderId) },
    { direction: "latest", company_id: orderId },
  ])("rejects invalid or unbounded input before database work: %j", (input) => {
    const getOrderPage = vi.fn();
    const service = new TicketService({ repository: { getOrderPage } as unknown as TicketRepository });
    expect(() => service.getOrderPage(orderId, input)).toThrow();
    expect(getOrderPage).not.toHaveBeenCalled();
  });

  it("defaults the initial read to the newest page without changing full-detail reads", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { messages: [] }, error: null });
    const service = new TicketService({ repository: new TicketRepository({ rpc } as unknown as UserMutationClient) });
    await service.getOrderPage(orderId);
    expect(rpc.mock.calls[0]).toEqual(["app_get_order_conversation_page", {
      p_order_id: orderId, p_direction: "latest", p_cursor: null, p_retained_ids: [], p_fingerprint: null, p_request_ids: [],
    }]);
    await service.getForOrder(orderId);
    expect(rpc.mock.calls[1]).toEqual(["app_get_order_conversation", { p_order_id: orderId }]);
  });
});
