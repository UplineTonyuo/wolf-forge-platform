import { expect, it, vi } from 'vitest';
import { reconcileManualCallPresence } from '../services/ticket-call-provider';
const id='71000000-0000-4000-8000-000000000001',claimId='71000000-0000-4000-8000-000000000002';
it('does no provider work with no independently due manual calls',async()=>{
 const rpc={rpc:vi.fn().mockResolvedValue({data:[],error:null})},provider={readPresence:vi.fn()};
 expect(await reconcileManualCallPresence(rpc,provider)).toEqual({checked:0});expect(provider.readPresence).not.toHaveBeenCalled();
});
it('persists only a validated exact-room presence response for the durable claim',async()=>{
 const presence={total_count:2,data:[{id:'session-a',room:`wf-call-${id}`,userId:id},{id:'session-b',room:`wf-call-${id}`,userId:claimId}]};
 const rpc={rpc:vi.fn().mockResolvedValueOnce({data:[{id,claimId,roomName:`wf-call-${id}`}],error:null}).mockResolvedValue({data:true,error:null})};
 expect(await reconcileManualCallPresence(rpc,{readPresence:vi.fn().mockResolvedValue(presence)})).toEqual({checked:1});
 expect(rpc.rpc).toHaveBeenLastCalledWith('app_finish_manual_call_check',{p_call_id:id,p_claim_id:claimId,p_presence:presence});
});
it('never certifies absence when a provider request fails or gives partial/foreign data',async()=>{
 for(const value of [null,{total_count:2,data:[]},{total_count:1,data:[{id:'s',room:'other',userId:id}]}]){
  const rpc={rpc:vi.fn().mockResolvedValueOnce({data:[{id,claimId,roomName:`wf-call-${id}`}],error:null}).mockResolvedValue({data:false,error:null})};
  expect(await reconcileManualCallPresence(rpc,{readPresence:vi.fn().mockResolvedValue(value)})).toEqual({checked:0});
  expect(rpc.rpc).toHaveBeenLastCalledWith('app_finish_manual_call_check',{p_call_id:id,p_claim_id:claimId,p_presence:null});
 }
});
