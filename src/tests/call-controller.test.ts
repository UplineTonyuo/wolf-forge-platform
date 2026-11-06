import { expect,it,vi } from "vitest";
import { CallController } from "../components/calls/call-controller";
import { callTimeLimitReached } from "../components/calls/call-controller";
it('expires fixed and setup deadlines but keeps authorized manual active calls open beyond two hours',()=>{
 const start=Date.parse('2026-11-06T12:00:00Z');
 const clock={state:'active' as const,expiresAt:new Date(start+900000).toISOString(),acceptedAt:new Date(start).toISOString(),ringDeadline:null,durationPolicy:'manual' as const};
 expect(callTimeLimitReached(clock,start+7200000)).toBe(false);
 expect(callTimeLimitReached({...clock,durationPolicy:'fixed'},start+900000)).toBe(true);
 expect(callTimeLimitReached({...clock,state:'connecting'},start+45000)).toBe(true);
 expect(callTimeLimitReached({...clock,state:'ringing',acceptedAt:null,ringDeadline:new Date(start+40000).toISOString()},start+40000)).toBe(true);
});
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

it.each(["declined","missed","answered"] as const)("can redial after %s, with or without closing the ended screen",async outcome=>{
 for(const closeEnded of [true,false])for(const clearEnded of [false,true]){
  const requests:string[]=[];const invitations=new Map<string,TicketCall>();let latest:TicketCall|null=null;
  const send=vi.fn(async(_path:RequestInfo|URL,init?:RequestInit)=>{
   if(init?.method==="POST"){
    const body=JSON.parse(init.body as string);requests.push(body.request_id);
    if(!invitations.has(body.request_id))invitations.set(body.request_id,call({id:invitations.size?old:id,callerId:id,calleeId:peer}));
    latest=invitations.get(body.request_id)!;return Response.json({ok:true,data:latest});
   }
   return Response.json(availability(latest?.state==="ended"&&!String(_path).includes("call_id=")?null:latest));
  });
  const controller=new CallController(id,send);
  try{
   await controller.request(id,"audio",{},peer);
   latest={...latest!,state:"ended",outcome,version:2};invitations.set(requests[0]!,latest);
   await controller.refresh({call_id:id});if(clearEnded)await controller.refresh();if(closeEnded)controller.close();
   await controller.request(id,"audio",{},peer);
   expect(new Set(requests).size).toBe(2);expect(controller.snapshot().call?.id).toBe(old);expect(controller.snapshot().call?.state).toBe("ringing");
  }finally{controller.dispose();}
 }
});

it.each([false,true])("preserves an uncertain invitation retry after a completed call: %s",async previousEnded=>{
 const requests:string[]=[];let latest:TicketCall|null=null;let loseResponse=true;
 const invitations=new Map<string,TicketCall>();
 const send=vi.fn(async(_path:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method==="POST"){
   const body=JSON.parse(init.body as string);requests.push(body.request_id);
   if(!invitations.has(body.request_id))invitations.set(body.request_id,call({id:invitations.size?old:id,callerId:id,calleeId:peer}));
   latest=invitations.get(body.request_id)!;
   if(loseResponse&&(!previousEnded||requests.length===2)){loseResponse=false;throw new Error("Response lost after server acceptance");}
   return Response.json({ok:true,data:latest});
  }
  return Response.json(availability(latest));
 });
 const controller=new CallController(id,send);
 try{
  if(previousEnded){
   await controller.request(id,"audio",{},peer);
   latest={...latest!,state:"ended",outcome:"declined",version:2};invitations.set(requests[0]!,latest);
   await controller.refresh({call_id:id});
  }
  await controller.request(id,"audio",{},peer);controller.close();
  await controller.request(id,"audio",{},peer);
  expect(requests.at(-1)).toBe(requests.at(-2));expect(invitations.size).toBe(previousEnded?2:1);
  expect(controller.snapshot().call?.state).toBe("ringing");
 }finally{controller.dispose();}
});
