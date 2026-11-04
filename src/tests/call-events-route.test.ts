import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f=vi.hoisted(()=>({context:vi.fn(),authorize:vi.fn(),rpc:vi.fn(),subscribe:vi.fn(),on:vi.fn(),remove:vi.fn(),disconnect:vi.fn()}));
vi.mock("../lib/supabase/next-server",()=>({getVerifiedSessionContext:f.context}));
vi.mock("../lib/supabase/user-client",()=>({authenticateUserRealtime:f.authorize}));
const {GET}=await import("../app/api/ticket-call-events/route");
const id="71000000-0000-4000-8000-000000000001",topic=`ticket-calls:${id}:${id}`;
const leaseId="71000000-0000-4000-8000-000000000002";
const lease=()=>({topic,leaseId,expiresAt:new Date(Date.now()+90000).toISOString()});
const channel={on:f.on,subscribe:f.subscribe};
const req=(signal?:AbortSignal)=>new Request("https://app.example/api/ticket-call-events",{headers:{"sec-fetch-site":"same-origin"},signal});
beforeEach(()=>{
 vi.stubEnv("DAILY_CALLS_ENABLED","1");vi.stubEnv("DAILY_DOMAIN","wolfforge.daily.co");vi.stubEnv("DAILY_API_KEY","synthetic");
 f.context.mockResolvedValue({actor:{id},client:{rpc:f.rpc,channel:()=>channel,removeChannel:f.remove,realtime:{disconnect:f.disconnect}}});
 f.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==="app_ticket_call_signal_context"?lease():name==="app_ticket_call_signal_lease"?{expiresAt:lease().expiresAt}:true,error:null}));f.authorize.mockResolvedValue(60000);f.on.mockReturnValue(channel);f.remove.mockResolvedValue("ok");f.disconnect.mockResolvedValue("ok");
 f.subscribe.mockImplementation((cb:(s:string)=>void)=>{cb("SUBSCRIBED");return channel;});
});
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();vi.unstubAllEnvs();});
it("opens one authorized payload-free stream and releases its channel on cancellation",async()=>{
 const abort=new AbortController();const response=await GET(req(abort.signal));expect(response.headers.get("content-type")).toContain("text/event-stream");
 const reader=response.body!.getReader();await reader.read();const first=new TextDecoder().decode((await reader.read()).value);expect(first).toContain("event: wake");expect(first).not.toContain(id);
 const wake=f.on.mock.calls[0]![2] as ()=>void;wake();const next=new TextDecoder().decode((await reader.read()).value);expect(next).toContain("data: {}");
 abort.abort();await reader.cancel();expect(f.remove).toHaveBeenCalledOnce();await vi.waitFor(()=>expect(f.disconnect).toHaveBeenCalledOnce());
});
it.each([null,{actor:{id,support:{}},client:{}}])("does not subscribe without an ordinary verified session",async(context)=>{
 f.context.mockResolvedValue(context);expect((await GET(req())).status).toBe(context?403:401);expect(f.authorize).not.toHaveBeenCalled();
});
it("ends disabled calling without an idle stream or permission prompt",async()=>{
 vi.stubEnv("DAILY_CALLS_ENABLED","0");const response=await GET(req());expect(await response.text()).toContain("event: disabled");expect(f.context).not.toHaveBeenCalled();
});
it("cancels a reader without trying to close its already-canceled stream",async()=>{
 const response=await GET(req());const reader=response.body!.getReader();await reader.read();
 await expect(reader.cancel()).resolves.toBeUndefined();expect(f.remove).toHaveBeenCalledOnce();
});
it("refuses foreign-origin requests and unauthorized topics",async()=>{
 expect((await GET(new Request("https://app.example/api/ticket-call-events",{headers:{"sec-fetch-site":"cross-site"}}))).status).toBe(403);
 f.rpc.mockResolvedValue({data:{...lease(),topic:`ticket-calls:${id}:71000000-0000-4000-8000-000000000002`},error:null});
 expect((await GET(req())).status).toBe(403);expect(f.authorize).not.toHaveBeenCalled();
});

it("releases its exact lease on disconnect once",async()=>{
 const abort=new AbortController();const response=await GET(req(abort.signal));
 abort.abort();await response.body!.cancel();
 expect(f.rpc).toHaveBeenCalledWith("app_ticket_call_signal_lease",{p_action:"release",p_lease_id:leaseId});
 expect(f.rpc.mock.calls.filter(c=>c[1]?.p_action==="release")).toHaveLength(1);
});
it("returns 429 without opening a channel when concurrent admission is full",async()=>{
 f.rpc.mockResolvedValue({data:null,error:{code:"WF429",message:"rate limit exceeded"}});
 const response=await GET(req());expect(response.status).toBe(429);
 expect(response.headers.get("retry-after")).toBe("90");expect(f.authorize).not.toHaveBeenCalled();
 expect(f.subscribe).not.toHaveBeenCalled();
});
it("renews a live lease and releases it at the existing stream lifetime",async()=>{
 vi.useFakeTimers();f.authorize.mockResolvedValue(240000);
 const response=await GET(req());await vi.advanceTimersByTimeAsync(30000);
 expect(f.rpc).toHaveBeenCalledWith("app_ticket_call_signal_lease",{p_action:"renew",p_lease_id:leaseId});
 await vi.advanceTimersByTimeAsync(210000);
 expect(f.remove).toHaveBeenCalledOnce();
 expect(f.rpc).toHaveBeenCalledWith("app_ticket_call_signal_lease",{p_action:"release",p_lease_id:leaseId});
 await response.body!.cancel();
});
it.each([null,{error:{code:"42501"},data:null}])("closes on expired or denied renewal",async(result)=>{
 vi.useFakeTimers();f.authorize.mockResolvedValue(240000);
 const response=await GET(req());
 f.rpc.mockResolvedValue(result??{data:null,error:null});
 await vi.advanceTimersByTimeAsync(30000);
 expect(f.remove).toHaveBeenCalledOnce();await response.body!.cancel();
});
it("expires locally if renewal stalls and ignores a late successful renewal",async()=>{
 vi.useFakeTimers();f.authorize.mockResolvedValue(240000);
 const response=await GET(req());let resolve!:(value:unknown)=>void;
 f.rpc.mockImplementation((_name:string,args:Record<string,unknown>)=>args.p_action==="renew"
  ?new Promise(r=>{resolve=r;}):Promise.resolve({data:true,error:null}));
 await vi.advanceTimersByTimeAsync(90000);
 expect(f.remove).toHaveBeenCalledOnce();
 resolve({data:{expiresAt:new Date(Date.now()+90000).toISOString()},error:null});await vi.advanceTimersByTimeAsync(90000);
 expect(f.subscribe).toHaveBeenCalledOnce();expect(f.remove).toHaveBeenCalledOnce();
 expect(f.rpc.mock.calls.filter(c=>c[1]?.p_action==="renew")).toHaveLength(1);
 await response.body!.cancel();
});
it("releases a lease acquired after an early abort without authenticating Realtime",async()=>{
 let resolve!:(value:unknown)=>void;f.rpc.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const abort=new AbortController();const pending=GET(req(abort.signal));
 await vi.waitFor(()=>expect(f.rpc).toHaveBeenCalled());abort.abort();
 resolve({data:lease(),error:null});const response=await pending;
 expect(response.status).toBe(204);expect(f.authorize).not.toHaveBeenCalled();
 expect(f.rpc).toHaveBeenCalledWith("app_ticket_call_signal_lease",{p_action:"release",p_lease_id:leaseId});
});
it("releases admission if Realtime authentication or subscription fails",async()=>{
 f.authorize.mockRejectedValue(new Error("auth failed"));expect((await GET(req())).status).toBe(503);
 expect(f.rpc).toHaveBeenCalledWith("app_ticket_call_signal_lease",{p_action:"release",p_lease_id:leaseId});
 f.authorize.mockResolvedValue(240000);f.subscribe.mockImplementation((cb:(s:string)=>void)=>{cb("CHANNEL_ERROR");return channel;});
 expect((await GET(req())).status).toBe(503);expect(f.remove).toHaveBeenCalledOnce();
});
