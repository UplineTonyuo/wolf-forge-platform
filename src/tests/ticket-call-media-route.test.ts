import { beforeEach, expect, it, vi } from "vitest";
import { ApplicationError } from "../lib/errors/application-error";
const f=vi.hoisted(()=>({context:vi.fn(),prepare:vi.fn(),config:vi.fn(),trusted:vi.fn()}));
vi.mock("../lib/supabase/next-server",()=>({getVerifiedSessionContext:f.context}));
vi.mock("../services/ticket-call-provider",()=>({prepareTicketCallMedia:f.prepare}));
vi.mock("../lib/daily/calls",()=>({readDailyCallConfig:f.config}));
vi.mock("../lib/daily/provider",()=>({createDailyCallProvider:vi.fn()}));
vi.mock("../lib/supabase/trusted-server-client",()=>({createTrustedServerSupabaseClient:f.trusted}));
vi.mock("../lib/env/server-env",()=>({readServerEnvironment:()=>({})}));
const {POST}=await import("../app/api/ticket-call-media/route");
const id="71000000-0000-4000-8000-000000000001";
const request=(value:unknown)=>new Request("https://app.example/api/ticket-call-media",{method:"POST",headers:{origin:"https://app.example",host:"app.example","content-type":"application/json"},body:JSON.stringify(value)});
beforeEach(()=>{vi.clearAllMocks();f.config.mockReturnValue({key:"test"});f.context.mockResolvedValue({actor:{id},client:{}});f.prepare.mockResolvedValue({callId:id});});
it("does no provider work while disabled",async()=>{f.config.mockReturnValue(null);expect((await POST(request({call_id:id,device_id:id}))).status).toBe(503);expect(f.prepare).not.toHaveBeenCalled();});
it("rejects support impersonation and browser-selected room or actor",async()=>{
 f.context.mockResolvedValue({actor:{support:{}},client:{}});expect((await POST(request({call_id:id,device_id:id}))).status).toBe(403);
 expect((await POST(request({call_id:id,device_id:id,room:"foreign"}))).status).toBe(400);expect(f.prepare).not.toHaveBeenCalled();
});
it("returns media only through the guarded provider boundary without caching",async()=>{const r=await POST(request({call_id:id,device_id:id}));expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toContain("no-store");expect(f.prepare).toHaveBeenCalledOnce();});
it("returns an explicit retry delay for shared media throttles",async()=>{
 f.prepare.mockRejectedValue(new ApplicationError("RATE_LIMITED","Too many requests"));
 const response=await POST(request({call_id:id,device_id:id}));
 expect(response.status).toBe(429);expect(response.headers.get("retry-after")).toBe("60");
 expect(await response.json()).toMatchObject({ok:false});
});
