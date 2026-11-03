import { expect, it, vi } from "vitest";
import { reconcileDailyCalls } from "../lib/daily/reconciliation";
const id="71000000-0000-4000-8000-000000000001";
const lease={id,month:"2026-11-01",cutoff:1793707200,cursor:null};
it("has no provider requests when another worker owns the durable lease",async()=>{
 const rpc={rpc:vi.fn().mockResolvedValue({data:null,error:null})};const read=vi.fn();
 expect(await reconcileDailyCalls(rpc,read)).toEqual({pages:0,complete:false});expect(read).not.toHaveBeenCalled();
});
it("keeps progress durable and bounds a run to one provider page",async()=>{
 const rpc={rpc:vi.fn().mockResolvedValueOnce({data:lease,error:null}).mockResolvedValue({data:true,error:null})};
 const read=vi.fn().mockResolvedValue({total_count:1,data:[{id,room:"other",start_time:1793650000,duration:30,max_participants:0,ongoing:false,participants:[]} ]});
 expect(await reconcileDailyCalls(rpc,read)).toEqual({pages:1,complete:true});
 expect(rpc.rpc).toHaveBeenLastCalledWith("app_apply_ticket_call_provider_page",expect.objectContaining({p_scan_id:id,p_after:null,p_complete:true}));
});
it("rejects malformed pages and repeated pagination before updating accounting",async()=>{
 const rpc={rpc:vi.fn().mockResolvedValue({data:{...lease,cursor:id},error:null})};
 const read=vi.fn().mockResolvedValue({total_count:30,data:[{id,room:"other",start_time:1,duration:-1,ongoing:false,participants:[]}]});
 await expect(reconcileDailyCalls(rpc,read)).rejects.toThrow();expect(rpc.rpc).toHaveBeenCalledTimes(1);
});
