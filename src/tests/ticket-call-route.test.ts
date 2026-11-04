import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ context: vi.fn(), mutate: vi.fn(), read: vi.fn(), end: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getVerifiedSessionContext: f.context }));
vi.mock("../services/ticket-call-service", () => ({ mutateTicketCall: f.mutate, readTicketCalls: f.read, endTicketCall: f.end }));
const { GET, POST, DELETE } = await import("../app/api/ticket-calls/route");
const id = "71000000-0000-4000-8000-000000000001";
const request = (body: unknown, method = "POST", origin = "https://app.example") => new Request("https://app.example/api/ticket-calls", {
  method, headers: { origin, host: "app.example", "content-type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("DAILY_CALLS_ENABLED","1"); vi.stubEnv("DAILY_DOMAIN","wolfforge.daily.co"); vi.stubEnv("DAILY_API_KEY","synthetic"); f.context.mockResolvedValue({ actor: {}, client: {} }); f.mutate.mockResolvedValue({ outcome: "busy" }); f.end.mockResolvedValue({ ended: true }); });
it("stops new admission when the provider switch is off but permits ending", async()=>{
 vi.stubEnv("DAILY_CALLS_ENABLED","0");
 expect((await POST(request({action:"request",ticket_id:id,request_id:id,device_id:id,mode:"audio"}))).status).toBe(503);
 expect(f.mutate).not.toHaveBeenCalled();
 expect((await POST(request({action:"end",call_id:id}))).status).toBe(200);
});
it("refuses foreign origin before authentication", async () => {
  expect((await POST(request({}, "POST", "https://foreign.example"))).status).toBe(403);
  expect(f.context).not.toHaveBeenCalled();
});
it("refuses the old implicit Join payload", async () => {
  expect((await POST(request({ ticket_id: id, request_id: id, mode: "audio" }))).status).toBe(400);
  expect(f.mutate).not.toHaveBeenCalled();
});
it("keeps legacy controls disabled even if the old provider flag is set", async () => {
  const response = await GET(new Request(`https://app.example/api/ticket-calls?ticket_id=${id}`, { headers: { "sec-fetch-site": "same-origin" } }));
  expect(await response.json()).toEqual({ ok: true, enabled: false, call: null });
  expect(f.context).not.toHaveBeenCalled();
});
it("returns logged busy without exposing provider details", async () => {
  const body = { action: "request", ticket_id: id, request_id: id, device_id: id, mode: "audio" };
  const response = await POST(request(body));
  expect(await response.json()).toEqual({ ok: true, data: { outcome: "busy" } });
  expect(f.mutate).toHaveBeenCalledWith({}, body);
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it("requires an authenticated session", async () => {
  f.context.mockResolvedValue(null);
  expect((await POST(request({ action: "end", call_id: id }))).status).toBe(401);
  expect(f.mutate).not.toHaveBeenCalled();
});
it("explains the intentional support-session restriction without reading call data", async () => {
  f.context.mockResolvedValue({ actor: { support: true }, client: {} });
  const response = await GET(new Request(`https://app.example/api/ticket-calls?action=history&ticket_id=${id}`, { headers: { "sec-fetch-site": "same-origin" } }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ ok: false, code: "SUPPORT_MODE" });
  expect(f.read).not.toHaveBeenCalled();
});
it("allows narrow legacy termination without a Ticket read", async () => {
  expect((await DELETE(request({ ticket_id: id, call_id: id }, "DELETE"))).status).toBe(200);
  expect(f.end).toHaveBeenCalledWith({}, id, id);
});
it("keeps genuine-client history readable independently of provider enablement", async () => {
  vi.stubEnv("DAILY_CALLS_ENABLED","0");
  f.context.mockResolvedValue({actor:{accountClass:"client"},client:{}});
  f.read.mockResolvedValue([]);
  const response=await GET(new Request(`https://app.example/api/ticket-calls?action=history&ticket_id=${id}`,{headers:{"sec-fetch-site":"same-origin"}}));
  expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,data:[]});
});
it.each([["RATE_LIMITED",429,"RATE_LIMITED"],["DATABASE_ERROR",503,"CALL_SERVICE_UNAVAILABLE"]])("reports sanitized %s reads without exposing backend detail",async(code,status,safeCode)=>{
 f.read.mockRejectedValueOnce({code,message:"synthetic private backend detail"});
 const response=await GET(new Request(`https://app.example/api/ticket-calls?action=history&order_id=${id}`,{headers:{"sec-fetch-site":"same-origin"}}));
 expect(response.status).toBe(status);expect(await response.json()).toMatchObject({ok:false,code:safeCode});
});
