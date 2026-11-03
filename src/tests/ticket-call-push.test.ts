import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ context: vi.fn(), support: vi.fn(), headers: vi.fn(), rpc: vi.fn() }));
vi.mock("next/headers", () => ({ headers: f.headers }));
vi.mock("../lib/supabase/next-server", () => ({ getVerifiedSessionContext: f.context }));
vi.mock("../lib/supabase/client-support", () => ({ clientSupportRequested: f.support }));
const origin = "https://wolf-forge-platform-callstest-wolf-forge.vercel.app";
const endpoint = "https://fcm.googleapis.com/call-device-test";
const config = { origin, publicKey: "A".repeat(87) };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("SUPABASE_URL", "https://rsnmlcyopnxucwgfttyf.supabase.co");
  vi.stubEnv("DAILY_CALLS_ENABLED","1");vi.stubEnv("DAILY_DOMAIN","wolfforge.daily.co");vi.stubEnv("DAILY_API_KEY","synthetic");
  f.support.mockResolvedValue(false); f.context.mockResolvedValue({ actor: { id: "self" }, client: { rpc: f.rpc } });
  f.headers.mockResolvedValue(new Headers({ host: new URL(origin).host }));
  f.rpc.mockResolvedValue({ data: config, error: null });
});
afterEach(() => vi.unstubAllEnvs());
it("allows own internal/client configuration without changing the message context", async () => {
  const { callPushContext } = await import("../lib/notifications/call-push-server");
  expect((await callPushContext())?.config).toEqual(config);
  expect(f.rpc).toHaveBeenCalledWith("app_get_my_call_push_configuration", {});
});
it.each(["support", "backend", "host", "private key", "disabled"])("refuses %s before enrollment", async reason => {
  if (reason === "disabled") vi.stubEnv("DAILY_CALLS_ENABLED","0");
  if (reason === "support") f.support.mockResolvedValue(true);
  if (reason === "backend") vi.stubEnv("SUPABASE_URL", "https://unapproved.supabase.co");
  if (reason === "host") f.headers.mockResolvedValue(new Headers({ host: "different.invalid" }));
  if (reason === "private key") f.rpc.mockResolvedValue({ data: { ...config, privateKey: "must-not-leak" }, error: null });
  const { callPushContext } = await import("../lib/notifications/call-push-server");
  expect(await callPushContext()).toBeNull();
  if (reason === "support" || reason === "backend") expect(f.context).not.toHaveBeenCalled();
});
it("bounds same-origin endpoint requests and never accepts a recipient", async () => {
  const { POST } = await import("../app/api/ticket-call-push/route");
  const request = (body: unknown, from = origin) => new Request(origin+"/api/ticket-call-push", { method: "POST", headers: { origin: from, host: new URL(origin).host, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await POST(request({ action: "set", endpoint, enabled: true, profileId: "other" }))).status).toBe(400);
  expect((await POST(request({ action: "set", endpoint, enabled: true }, "https://foreign.invalid"))).status).toBe(403);
  expect(f.context).not.toHaveBeenCalled();
  f.rpc.mockImplementation(async (name: string) => ({ data: name === "app_get_my_call_push_configuration" ? config : true, error: null }));
  expect((await POST(request({ action: "set", endpoint, enabled: true }))).status).toBe(200);
  expect(f.rpc).toHaveBeenLastCalledWith("app_set_my_call_push_subscription", { p_endpoint: endpoint, p_origin: origin, p_enabled: true });
});
