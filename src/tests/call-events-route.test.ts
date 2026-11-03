import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f=vi.hoisted(()=>({context:vi.fn(),authorize:vi.fn(),rpc:vi.fn(),subscribe:vi.fn(),on:vi.fn(),remove:vi.fn(),disconnect:vi.fn()}));
vi.mock("../lib/supabase/next-server",()=>({getVerifiedSessionContext:f.context}));
vi.mock("../lib/supabase/user-client",()=>({authenticateUserRealtime:f.authorize}));
const {GET}=await import("../app/api/ticket-call-events/route");
const id="71000000-0000-4000-8000-000000000001",topic=`ticket-calls:${id}:${id}`;
const channel={on:f.on,subscribe:f.subscribe};
const req=(signal?:AbortSignal)=>new Request("https://app.example/api/ticket-call-events",{headers:{"sec-fetch-site":"same-origin"},signal});
beforeEach(()=>{
 vi.stubEnv("DAILY_CALLS_ENABLED","1");vi.stubEnv("DAILY_DOMAIN","wolfforge.daily.co");vi.stubEnv("DAILY_API_KEY","synthetic");
 f.context.mockResolvedValue({actor:{id},client:{rpc:f.rpc,channel:()=>channel,removeChannel:f.remove,realtime:{disconnect:f.disconnect}}});
 f.rpc.mockResolvedValue({data:{topic},error:null});f.authorize.mockResolvedValue(60000);f.on.mockReturnValue(channel);f.remove.mockResolvedValue("ok");f.disconnect.mockResolvedValue("ok");
 f.subscribe.mockImplementation((cb:(s:string)=>void)=>{cb("SUBSCRIBED");return channel;});
});
afterEach(()=>{vi.clearAllMocks();vi.unstubAllEnvs();});
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
 f.rpc.mockResolvedValue({data:{topic:`ticket-calls:${id}:71000000-0000-4000-8000-000000000002`},error:null});
 expect((await GET(req())).status).toBe(403);expect(f.authorize).not.toHaveBeenCalled();
});
