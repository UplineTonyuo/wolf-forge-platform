import { expect,it,vi } from "vitest";
import { CallController } from "../components/calls/call-controller";
import type { TicketCall } from "../domain/tickets/calls";
const id="71000000-0000-4000-8000-000000000001";
const peer="71000000-0000-4000-8000-000000000002",old="71000000-0000-4000-8000-000000000003";
const call=(value:Partial<TicketCall>={}):TicketCall=>({id,ticketId:id,callerId:peer,calleeId:id,mode:"audio",direction:"client_to_team",state:"ringing",requestedAt:new Date().toISOString(),ringDeadline:new Date(Date.now()+40000).toISOString(),acceptedAt:null,answeredAt:null,endedAt:null,expiresAt:new Date(Date.now()+900000).toISOString(),outcome:null,reason:null,version:1,connectedSeconds:0,participantSeconds:0,reconciled:false,message:null,...value});
const availability=(value:TicketCall|null)=>({ok:true,data:{enabled:true,profileId:id,accountClass:"internal",call:value,ticketId:value?.ticketId??null,peer:null}});
it("serializes repeated start clicks into one request",async()=>{
 let complete!:(r:Response)=>void;const send=vi.fn(()=>new Promise<Response>(r=>{complete=r;}));
 const controller=new CallController(id,send);const first=controller.request(id,"audio");void controller.request(id,"audio");
 expect(send).toHaveBeenCalledTimes(1);complete(Response.json({ok:false}));await first;controller.dispose();
});
it("does not schedule polling while idle or disabled",async()=>{
 const send=vi.fn().mockResolvedValue(Response.json({ok:true,data:{enabled:false,profileId:id,accountClass:"internal",call:null,ticketId:null,peer:null}}));
 const controller=new CallController(id,send);await controller.refresh();expect(controller.snapshot().call).toBeNull();expect(controller.pollDelay()).toBeNull();controller.dispose();
});
it("keeps a failed end retry available while releasing local devices",async()=>{
 const controller=new CallController(id,vi.fn().mockRejectedValue(new Error("offline")));const stop=vi.fn();controller.onRelease=stop;
 await controller.end();expect(stop).toHaveBeenCalledOnce();controller.dispose();
});
it("queues an incoming read behind an existing status request instead of losing it",async()=>{
 let first!:(r:Response)=>void;const send=vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>{first=r;})).mockResolvedValue(Response.json(availability(call())));
 const controller=new CallController(id,send);const a=controller.refresh();const b=controller.refresh();first(Response.json(availability(null)));await Promise.all([a,b]);
 expect(controller.snapshot().call?.id).toBe(id);expect(send).toHaveBeenCalledTimes(2);controller.dispose();
});
it("an ended historical hint cannot replace or release another live call",async()=>{
 const send=vi.fn().mockResolvedValueOnce(Response.json(availability(call({state:"active"})))).mockResolvedValueOnce(Response.json(availability(call({id:old,state:"ended"}))));
 const controller=new CallController(id,send);const stop=vi.fn();controller.onRelease=stop;await controller.refresh();await controller.refresh({call_id:old});
 expect(controller.snapshot().call?.id).toBe(id);expect(stop).not.toHaveBeenCalled();controller.dispose();
});
it("late successful acceptance cannot restore media after failed hang-up",async()=>{
 let accept!:(r:Response)=>void;const send=vi.fn().mockResolvedValueOnce(Response.json(availability(call())))
 .mockImplementationOnce(()=>new Promise<Response>(r=>{accept=r;})).mockRejectedValueOnce(new Error("offline"));
 const controller=new CallController(id,send);await controller.refresh();const pending=controller.command("accept");await controller.end();
 accept(Response.json({ok:true,data:call({state:"accepted",acceptedAt:new Date().toISOString()})}));await pending;
 expect(controller.snapshot().canJoin).toBe(false);expect(controller.snapshot().error).toContain("retry End call");controller.dispose();
});
