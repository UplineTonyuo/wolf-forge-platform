import {beforeEach,expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({context:vi.fn(),rpc:vi.fn()}));
vi.mock("../lib/supabase/next-server",()=>({getClientContext:f.context,getInternalContext:vi.fn()}));
import {markOpenedClientNotificationsReadAction} from "../app/actions/notifications";
const opening={requestId:"71000000-0000-4000-8000-000000000001",requestedAt:"2026-11-04T14:00:00Z"};
beforeEach(()=>{vi.resetAllMocks();f.context.mockResolvedValue({client:{rpc:f.rpc}});});
it("validates opening identity before authentication or mutation",async()=>{
 for(const value of [null,[],{...opening,profileId:opening.requestId},{...opening,requestedAt:"invalid"}])expect((await markOpenedClientNotificationsReadAction(value)).ok).toBe(false);
 expect(f.context).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
});
it("acknowledges a complete server snapshot and authoritative unread count beyond 50",async()=>{
 f.rpc.mockResolvedValueOnce({data:{requestId:opening.requestId,snapshotAt:opening.requestedAt,readCount:151},error:null}).mockResolvedValueOnce({data:{notifications:[],unreadCount:1},error:null});
 expect(await markOpenedClientNotificationsReadAction(opening)).toEqual({ok:true,notifications:[],unreadCount:1});
 expect(f.rpc.mock.calls).toEqual([["app_open_client_notifications",{p_request_id:opening.requestId,p_requested_at:opening.requestedAt}],["app_client_notification_feed"]]);
});
it("does not claim success after mutation failure or a mismatched receipt",async()=>{
 f.rpc.mockResolvedValueOnce({data:null,error:{code:"42501"}});expect((await markOpenedClientNotificationsReadAction(opening)).ok).toBe(false);
 f.rpc.mockResolvedValueOnce({data:{requestId:"71000000-0000-4000-8000-000000000002",snapshotAt:opening.requestedAt,readCount:151},error:null});expect((await markOpenedClientNotificationsReadAction(opening)).ok).toBe(false);
 expect(f.rpc).toHaveBeenCalledTimes(2);
});
it("returns a sanitized expiry recovery code and server clock without treating conflicts as expiry",async()=>{
 f.rpc.mockResolvedValueOnce({data:null,error:{code:"22023",message:"Opening request expired or invalid"}});
 expect(await markOpenedClientNotificationsReadAction(opening)).toMatchObject({ok:false,code:"OPENING_EXPIRED",serverTime:expect.any(String)});
 f.rpc.mockResolvedValueOnce({data:null,error:{code:"22023",message:"Opening request conflicts"}});
 expect(await markOpenedClientNotificationsReadAction(opening)).not.toHaveProperty("code");
});
it("validates complete module-filtered counts before acknowledging a feed",async()=>{
 f.rpc.mockResolvedValueOnce({data:{requestId:opening.requestId,snapshotAt:opening.requestedAt,readCount:151},error:null})
  .mockResolvedValueOnce({data:{notifications:[],unreadCount:151,unreadCounts:{withoutTickets:150,withoutProjects:149,withoutConversations:148}},error:null});
 expect(await markOpenedClientNotificationsReadAction(opening)).toEqual({ok:true,notifications:[],unreadCount:151,unreadCounts:{withoutTickets:150,withoutProjects:149,withoutConversations:148}});
 f.rpc.mockResolvedValueOnce({data:{requestId:opening.requestId,snapshotAt:opening.requestedAt,readCount:151},error:null})
  .mockResolvedValueOnce({data:{notifications:[],unreadCount:1,unreadCounts:{withoutTickets:151,withoutProjects:0,withoutConversations:0}},error:null});
 expect((await markOpenedClientNotificationsReadAction(opening)).ok).toBe(false);
});
