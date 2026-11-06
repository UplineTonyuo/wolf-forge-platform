import {beforeEach,expect,it,vi} from 'vitest';
import {prepareTicketCallMedia,reconcileTicketCallCleanup} from '../services/ticket-call-provider';
import {callRoomProperties} from '../lib/daily/calls';
const id='71000000-0000-4000-8000-000000000001',claimId='71000000-0000-4000-8000-000000000002';
const roomName=`wf-call-${id}`,room={name:roomName,url:`https://wolfforge.daily.co/${roomName}`,privacy:'private',config:callRoomProperties(0,'manual')};
const work=()=>({id,claimId,roomName,reconcileOnly:true,durationPolicy:'manual',setupPending:false,roomClaimId:claimId,joinNotAfter:new Date(Date.now()-10000).toISOString(),mediaEmptyAt:null});
const provider={createRoom:vi.fn(),readRoom:vi.fn(),createToken:vi.fn(),ejectRoom:vi.fn(),deleteRoom:vi.fn(),readPresence:vi.fn()};
beforeEach(()=>{vi.resetAllMocks();provider.readRoom.mockResolvedValue(room);provider.readPresence.mockResolvedValue({total_count:0,data:[]});});
it('recovers a timed-out initial cleanup using fresh presence instead of remaining read-only forever',async()=>{
 const rpc={rpc:vi.fn().mockResolvedValueOnce({data:[work()],error:null}).mockResolvedValue({data:true,error:null})};
 provider.readPresence.mockResolvedValueOnce({total_count:1,data:[{id:'provider-session',room:roomName,userId:id}]}).mockResolvedValue({total_count:0,data:[]});
 provider.readRoom.mockResolvedValueOnce(room).mockResolvedValueOnce(null);
 expect(await reconcileTicketCallCleanup(rpc,provider)).toEqual({absent:1});
 expect(provider.ejectRoom).toHaveBeenCalledOnce();expect(provider.deleteRoom).toHaveBeenCalledOnce();
 const record=rpc.rpc.mock.calls.findIndex(c=>c[0]==='app_record_manual_call_empty');expect(record).toBeGreaterThan(0);
 expect(rpc.rpc.mock.invocationCallOrder[record]).toBeLessThan(provider.deleteRoom.mock.invocationCallOrder[0]!);
});
it('does not delete or certify a manual room while old join tokens can still be used',async()=>{
 const rpc={rpc:vi.fn().mockResolvedValueOnce({data:[{...work(),joinNotAfter:new Date(Date.now()+60000).toISOString()}],error:null}).mockResolvedValue({data:true,error:null})};
 expect(await reconcileTicketCallCleanup(rpc,provider)).toEqual({absent:0});expect(provider.deleteRoom).not.toHaveBeenCalled();
 expect(rpc.rpc).toHaveBeenLastCalledWith('app_finish_ticket_call_cleanup',{p_call_id:id,p_claim_id:claimId,p_verified:false});
});
it('does not certify a missing room while its original create is unresolved',async()=>{
 const rpc={rpc:vi.fn().mockResolvedValueOnce({data:[{...work(),setupPending:true}],error:null}).mockResolvedValue({data:true,error:null})};provider.readRoom.mockResolvedValue(null);
 expect(await reconcileTicketCallCleanup(rpc,provider)).toEqual({absent:0});
 expect(rpc.rpc).toHaveBeenLastCalledWith('app_finish_ticket_call_cleanup',{p_call_id:id,p_claim_id:claimId,p_verified:false});
});
it('reconciles a late-created room through its original setup claim without deleting under a stale cleanup claim',async()=>{
 const rpc={rpc:vi.fn().mockResolvedValueOnce({data:[{...work(),setupPending:true}],error:null}).mockResolvedValue({data:false,error:null})};
 expect(await reconcileTicketCallCleanup(rpc,provider)).toEqual({absent:0});expect(provider.deleteRoom).not.toHaveBeenCalled();
 expect(rpc.rpc).toHaveBeenLastCalledWith('app_complete_ticket_call_room',{p_call_id:id,p_claim_id:claimId,p_room:room});
});
it('does not treat missing room alone as durable media-stop evidence',async()=>{
 const rpc={rpc:vi.fn().mockResolvedValueOnce({data:[work()],error:null}).mockResolvedValue({data:true,error:null})};provider.readRoom.mockResolvedValue(null);
 expect(await reconcileTicketCallCleanup(rpc,provider)).toEqual({absent:0});
});
it('can finish an uncertain deletion using persisted empty presence plus fresh absence',async()=>{
 const rpc={rpc:vi.fn().mockResolvedValueOnce({data:[{...work(),mediaEmptyAt:new Date().toISOString()}],error:null}).mockResolvedValue({data:true,error:null})};provider.readRoom.mockResolvedValue(null);
 expect(await reconcileTicketCallCleanup(rpc,provider)).toEqual({absent:1});expect(provider.deleteRoom).not.toHaveBeenCalled();
});
it('a create finishing after hang-up reaches the durable completion callback and never issues a token',async()=>{
 let finish!:(value:unknown)=>void;provider.createRoom.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const pending={id,claimId,roomName,mode:'audio',durationPolicy:'manual',created:true,expiresAt:new Date(Date.now()+120000).toISOString()};
 const user={rpc:vi.fn().mockResolvedValue({data:pending,error:null})},trusted={rpc:vi.fn().mockResolvedValue({data:false,error:null})};
 const result=prepareTicketCallMedia(user,trusted,provider,id,claimId);await vi.waitFor(()=>expect(provider.createRoom).toHaveBeenCalled());
 finish(room);await expect(result).rejects.toThrow('setup unavailable');
 expect(trusted.rpc).toHaveBeenCalledWith('app_complete_ticket_call_room',{p_call_id:id,p_claim_id:claimId,p_room:room});expect(provider.createToken).not.toHaveBeenCalled();
});
