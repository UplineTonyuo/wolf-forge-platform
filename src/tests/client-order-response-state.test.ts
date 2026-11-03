import { describe, expect, it, vi } from "vitest";
import { OrderRepository } from "../repositories/order-repository";
import { OrderService } from "../services/order-service";

const id = "10000000-0000-4000-8000-000000000001";
describe("client-only order response metadata", () => {
  it("deduplicates the client batch and skips empty requests", async () => {
    const rpc=vi.fn().mockResolvedValue({data:[{order_id:id,unanswered:true}],error:null});
    const repo=new OrderRepository({rpc} as never);
    expect(await repo.listClientResponseStates([])).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
    expect(await repo.listClientResponseStates([id,id])).toEqual([{order_id:id,unanswered:true}]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("app_list_my_order_response_states",{p_order_ids:[id]});
  });
  it("preserves unknown results and refuses denied or malformed replies", async () => {
    const rpc=vi.fn().mockResolvedValue({data:[{order_id:id,unanswered:null}],error:null});
    const repo=new OrderRepository({rpc} as never);
    expect(await repo.listClientResponseStates([id])).toEqual([{order_id:id,unanswered:null}]);
    rpc.mockResolvedValue({data:null,error:{code:"42501",message:"denied"}} as never);
    await expect(repo.listClientResponseStates([id])).rejects.toThrow();
    rpc.mockResolvedValue({data:[{order_id:id,unanswered:"false"}],error:null} as never);
    await expect(repo.listClientResponseStates([id])).rejects.toThrow();
  });
  it("validates IDs before dispatch and does not use internal metadata", async () => {
    const repository={listClientResponseStates:vi.fn().mockResolvedValue([]),listResponseStates:vi.fn()};
    const service=new OrderService({repository} as never);
    await expect(service.listClientResponseStates(["invalid"])).rejects.toThrow();
    expect(repository.listClientResponseStates).not.toHaveBeenCalled();
    expect(await service.listClientResponseStates([id])).toEqual([]);
    expect(repository.listClientResponseStates).toHaveBeenCalledExactlyOnceWith([id]);
    expect(repository.listResponseStates).not.toHaveBeenCalled();
  });
});
