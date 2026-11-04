/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTicketCallHistory } from "../components/tickets/use-ticket-call-history";
const id="71000000-0000-4000-8000-000000000001",other="71000000-0000-4000-8000-000000000002";
const call={id,ticketId:id,callerId:id,calleeId:other,mode:"audio",direction:"client_to_team",state:"ended",requestedAt:"2026-11-03T12:00:00Z",expiresAt:"2026-11-03T12:15:00Z",ringDeadline:null,acceptedAt:null,answeredAt:null,endedAt:"2026-11-03T12:00:40Z",outcome:"missed",reason:"ring_timeout",version:2,connectedSeconds:0,participantSeconds:0,reconciled:false,message:null,caller:{name:"Synthetic Client",avatarUrl:null},callee:{name:"Synthetic Owner",avatarUrl:null}};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("shows a deliberate support restriction without a retryable failure",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({ok:false,code:"SUPPORT_MODE"},{status:403})));
 const {result}=renderHook(()=>useTicketCallHistory(id));
 await waitFor(()=>expect(result.current.error).toContain("client-support"));
 expect(result.current.retryable).toBe(false);
});
it("deduplicates repeated authoritative pages and clears history on revoked access",async()=>{
 const fetcher=vi.fn(async()=>Response.json({ok:true,data:[call]}));vi.stubGlobal("fetch",fetcher);
 const {result}=renderHook(()=>useTicketCallHistory(id));await waitFor(()=>expect(result.current.entries).toHaveLength(1));
 act(()=>window.dispatchEvent(new Event("wolf-forge-call-history")));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(result.current.busy).toBe(false));expect(result.current.entries).toHaveLength(1);
 fetcher.mockResolvedValue(Response.json({ok:false},{status:403}));act(()=>window.dispatchEvent(new Event("wolf-forge-call-history")));
 await waitFor(()=>expect(result.current.entries).toHaveLength(0));expect(result.current.error).toBe("Call history is unavailable.");
});
it("discards an earlier Ticket's late history response after navigation",async()=>{
 let finish!:(response:Response)=>void;
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>{finish=r;})).mockResolvedValue(Response.json({ok:true,data:[{...call,id:other,ticketId:other}]}));vi.stubGlobal("fetch",fetcher);
 const {result,rerender}=renderHook(({ticketId})=>useTicketCallHistory(ticketId),{initialProps:{ticketId:id}});
 await waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());rerender({ticketId:other});
 await waitFor(()=>expect(result.current.entries[0]?.ticketId).toBe(other));
 await act(async()=>{finish(Response.json({ok:true,data:[call]}));});
 expect(result.current.entries.map(entry=>entry.ticketId)).toEqual([other]);
});
it("discards an old denied response whose JSON finishes after navigation",async()=>{
 let finish!:(value:unknown)=>void;
 const fetcher=vi.fn().mockResolvedValueOnce({status:403,json:()=>new Promise(resolve=>{finish=resolve;})}).mockResolvedValue(Response.json({ok:true,data:[{...call,id:other,ticketId:other}]}));
 vi.stubGlobal("fetch",fetcher);
 const {result,rerender}=renderHook(({ticketId})=>useTicketCallHistory(ticketId),{initialProps:{ticketId:id}});
 await waitFor(()=>expect(finish).toBeDefined());rerender({ticketId:other});
 await waitFor(()=>expect(result.current.entries[0]?.ticketId).toBe(other));
 await act(async()=>finish({ok:false,code:"SUPPORT_MODE"}));
 expect(result.current.entries[0]?.ticketId).toBe(other);expect(result.current.error).toBe("");expect(result.current.retryable).toBe(true);
});
