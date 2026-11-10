import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({ getContext:vi.fn(),getOrderPage:vi.fn(),getForOrder:vi.fn() }));
vi.mock("../lib/supabase/next-server",()=>({getTicketActorContext:mocks.getContext}));
const {POST}=await import("../app/api/ticket-live/route");
const orderId="10000000-0000-4000-8000-000000000001";
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.getContext.mockResolvedValue({tickets:{getOrderPage:mocks.getOrderPage,getForOrder:mocks.getForOrder}});
  mocks.getOrderPage.mockResolvedValue({messages:[],updates:[],page:{hasOlder:false,hasNewer:false},fingerprint:"bounded",changed:true});
});
function request(body:unknown,origin="http://localhost:3000") {
  return new Request("http://localhost:3000/api/ticket-live",{method:"POST",headers:{origin,host:"localhost:3000","content-type":"application/json"},body:JSON.stringify(body)});
}
describe("Order bounded live/read route",()=>{
  it("performs an authorized bounded refresh rather than reading the full history",async()=>{
    const result=await POST(request({order_id:orderId,fingerprint:null,page:{direction:"refresh",retainedIds:[]}}));
    expect(result.status).toBe(200);
    expect(mocks.getOrderPage).toHaveBeenCalledWith(orderId,{direction:"refresh",retainedIds:[],requestIds:[],cursor:null,fingerprint:null});
    expect(mocks.getForOrder).not.toHaveBeenCalled();
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect((await result.json()).data).toMatchObject({orderId,page:{hasOlder:false}});
  });
  it("refuses a foreign origin before resolving the actor",async()=>{
    expect((await POST(request({order_id:orderId,fingerprint:null},"https://foreign.invalid"))).status).toBe(403);
    expect(mocks.getContext).not.toHaveBeenCalled();
  });
  it("does not accept caller-supplied actor/company identities or over-sized windows",async()=>{
    expect((await POST(request({order_id:orderId,fingerprint:null,page:{direction:"refresh",retainedIds:Array(101).fill(orderId)}}))).status).toBe(400);
    expect(mocks.getOrderPage).not.toHaveBeenCalled();
  });
});
