import { expect,it,vi } from "vitest";
import { callMutation,callRead,ticketCall } from "../domain/tickets/calls";
import { callConversationPath } from "../domain/tickets/call-entry";
import { mutateTicketCall,readTicketCalls } from "../services/ticket-call-service";
import type { UserScopedClient } from "../lib/supabase/user-client";
const id="71000000-0000-4000-8000-000000000001";
it("accepts an explicit order target and refuses mixed targets",()=>{
 expect(callRead.safeParse({action:"history",order_id:id}).success).toBe(true);
 expect(callMutation.safeParse({action:"request",order_id:id,mode:"audio",request_id:id,device_id:id}).success).toBe(true);
 expect(callRead.safeParse({action:"current",ticket_id:id,order_id:id}).success).toBe(false);
 expect(callMutation.safeParse({action:"request",ticket_id:id,order_id:id,mode:"audio",request_id:id,device_id:id}).success).toBe(false);
});
it("routes orders through an explicit authorized RPC, never the Ticket request",async()=>{
 const rpc=vi.fn().mockResolvedValue({data:null,error:{code:"42501"}});
 const client={rpc} as unknown as UserScopedClient;
 await expect(mutateTicketCall(client,{action:"request",order_id:id,mode:"video",request_id:id,device_id:id})).rejects.toThrow();
 expect(rpc).toHaveBeenCalledWith("app_request_order_call",expect.objectContaining({p_order_id:id}));
 await expect(readTicketCalls(client,{action:"history",order_id:id})).rejects.toThrow();
 expect(rpc).toHaveBeenLastCalledWith("app_order_call_history",expect.objectContaining({p_order_id:id}));
});
it("deep links native or legacy-linked order calls to the correct order views",()=>{
 expect(callConversationPath("client",null,id,id)).toBe(`/account/projects/${id}?call=${id}`);
 expect(callConversationPath("internal",id,id,id)).toBe(`/orders/${id}?call=${id}`);
});
it.each([null,id])("derives the authorized order from the backward-compatible current-call projection; ticket=%s",async(ticketId)=>{
 const call=ticketCall.parse({id,ticketId,orderId:id,callerId:id,calleeId:id,mode:"audio",direction:"client_to_team",state:"ringing",requestedAt:"2026-11-04T00:00:00Z",ringDeadline:null,acceptedAt:null,answeredAt:null,endedAt:null,expiresAt:"2026-11-04T01:00:00Z",outcome:null,reason:null,version:1,connectedSeconds:0,participantSeconds:0,reconciled:false,message:null});
 const rpc=vi.fn().mockResolvedValue({data:{enabled:true,profileId:id,accountClass:"client",call,ticketId,peer:null},error:null});
 const result=await readTicketCalls({rpc} as unknown as UserScopedClient,{action:"current",call_id:id});
 expect(result).toMatchObject({orderId:id,call:{orderId:id,ticketId}});
});
